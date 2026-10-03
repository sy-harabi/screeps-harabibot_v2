# Colony-wide remote road maintenance sweep

Status: accepted
Date: 2026-10-02
Builds on: [0015](0015-remote-harvesting-and-reservation.md)

## Context

Remote road construction establishes the infrastructure needed for road-based remote hauling, but established roads still decay and may eventually disappear. Maintenance should preserve the roads that the colony actually uses without continuously scanning every historical remote path or maintaining one repairer per source.

The original HarabiBot used a colony-wide remote repair cycle:

1. detect sufficiently damaged remote infrastructure;
2. spawn one repairer;
3. let that repairer work through the colony's remote source paths;
4. spawn another repairer if the sweep outlives the first creep;
5. reuse surviving repairers as builders or upgraders after the sweep finishes.

That lifecycle worked well and remains the basis for v2. The rewrite preserves the useful behavior while making source selection explicit, bounding repeated path work, and allowing repair and movement in the same tick.

A source can remain present in the harvest plan after its infrastructure stops seeing meaningful use. Maintenance therefore also needs a way to distinguish recently active remote infrastructure from stale roads that should be allowed to decay.

## Decision

### 1. Remote road maintenance is one colony-wide sweep

Remote road maintenance belongs to colony harvest infrastructure. It is not a source-local operation and does not maintain one dedicated repairer per source.

When maintenance becomes active, the colony maintains one sweep through eligible remote source paths. Only one maintenance repairer is used. No replacement is pre-spawned; if the repairer dies before the sweep finishes, a new repairer is requested and continues from the persisted sweep cursor.

When the sweep finishes, the surviving maintenance repairer becomes a normal builder. Existing build policy may then convert that builder to an upgrader when there is no construction work.

### 2. Starting maintenance requires a currently ready source

A source may start a new maintenance cycle only when all of the following are true:

```text
remote source
roadsEstablished
our reservation
ready now
maintenance inspection is due
```

Harvest readiness is defined as:

```ts
ready = haulerRatio >= 1
```

Miner readiness remains separate. A source that is temporarily not ready does not trigger a new maintenance cycle.

If inspection is due but ready is false, the inspection remains due rather than being postponed. The source may therefore trigger maintenance as soon as readiness returns.

Once maintenance has started on a source, later readiness or reservation changes do not interrupt that source's current maintenance work.

### 3. Inspect each established source every 100 ticks

Each established remote source stores:

```ts
nextMaintenanceTick?: number
```

A due, ready source is inspected at most once per 100 ticks. Idle maintenance does not inspect source paths every tick.

If inspection finds no trigger condition:

```ts
nextMaintenanceTick = Game.time + 100
```

When initial remote construction finishes, the first inspection is also scheduled 100 ticks later.

### 4. Record the last tick each source was ready

Persistent source state records:

```ts
lastReadyTick?: number
```

Whenever a reserved remote source is ready, update this field to the current tick.

This timestamp prevents an active maintenance sweep from maintaining remote roads that remain in planning data but have not been used recently.

### 5. Active sweeps include recently used current remote sources

After a maintenance cycle has started, the next source is eligible when it:

```text
is a remote source in the colony's current harvest plan
has roadsEstablished
was ready within the last CREEP_LIFE_TIME
```

The recent-use window is one normal creep lifetime, 1500 ticks.

A source that has disappeared from the current harvest plan is not considered. No persistent snapshot of sweep source IDs is created.

Eligibility is checked when moving to the next source. Once work on a source has begun, that source is finished even if its `lastReadyTick` ages beyond the recent-use window while the repairer is working on it.

Current readiness and our-reservation are entry conditions for starting a new maintenance cycle, not requirements that must remain true throughout the active sweep.

### 6. Use 30% / 90% hysteresis

While maintenance is idle, an eligible due source triggers maintenance when its planned infrastructure contains a serious problem:

```text
planned road at or below 30% hits
missing planned road
missing source container
```

Normal source-container wear is primarily handled by miners. Maintenance recovers missing infrastructure and maintains roads.

Once a maintenance cycle is active, encountered roads are restored to at least 90% hits.

```text
idle:
  trigger at <= 30% or missing infrastructure

active:
  restore encountered roads to >= 90%
  then continue the sweep
```

This makes maintenance infrequent while making each spawned repairer useful across multiple remote paths.

### 7. A completed source is not revisited during the same sweep

The maintenance sweep has forward progress through the colony's existing source order.

The first source is the first due source where inspection discovers a trigger condition. After that source is completed, maintenance proceeds to later eligible sources in the existing order, wrapping as needed so the cycle can cover the colony's eligible remote sources once.

The persisted colony-wide state is intentionally small:

```ts
interface RemoteMaintenanceMemory {
  readonly startSourceId: Id<Source>
  sourceId: Id<Source>
  pathIndex: number
}
```

`pathIndex` is the next unprocessed infrastructure position for the current source. `startSourceId` marks the wrap boundary.

A completed source is not rescanned during the same cycle. Normal decay after repair therefore cannot cause the sweep to oscillate back to an earlier source.

### 8. Active maintenance processes only the current path position

Idle inspection may scan a whole source path once every 100 ticks. Active maintenance does not restart that scan every tick.

The repairer processes infrastructure monotonically from the source toward the base:

```text
source container
road path.length - 2
road path.length - 3
...
base
```

Each tick only the current `pathIndex` is inspected. Healthy infrastructure advances the cursor. Damaged infrastructure is repaired. Missing infrastructure is rebuilt before the cursor advances.

This follows the same general principle as path movement cursors: remember progress rather than rediscovering it.

### 9. Repair while moving toward the next damaged road

Repair and movement intents may occur in the same tick.

For a repairer with active WORK count W:

```text
repairPower = min(
  W * REPAIR_POWER,
  storedEnergy / REPAIR_COST
)

targetHits = road.hitsMax * 0.9
```

When the next damaged road is already within repair range:

- at range 2-3, repair it while continuing to approach;
- at range 0-1, stop if additional repair intents are still required;
- if the current repair intent reaches the 90% target, advance the cursor and continue moving in the same tick.

This allows repair work to start as soon as the next target enters range rather than waiting for the repairer to stand beside it.

Already passed path positions are not revisited during the same source pass.

### 10. Missing infrastructure is rebuilt by the maintenance repairer

A missing road or source container does not reopen the initial remote-construction lifecycle and does not clear `roadsEstablished`.

The maintenance repairer creates the required construction site directly and builds it before advancing the cursor.

Build completion is intentionally handled simply. The repairer builds the current site and observes the completed structure on a later tick; it does not predict build completion in order to issue a same-tick move optimization.

### 11. Repairer energy comes only from the source side

Maintenance repairers do not fetch energy from colony storage or colony logistics.

The refill order is:

```text
dropped energy near the source
source container
```

While a maintenance repairer is assigned to a source, reserve that repairer's carry capacity against the source's available energy. This prevents the same energy from being simultaneously treated as available hauling supply.

Maintenance does not use the remote-builder carry-equivalent calculation.

### 12. Maintenance repairers reuse the remote-builder body shape

The remote-builder unit is also used for maintenance:

```text
3 WORK
5 CARRY
4 MOVE
750 energy
```

The body may scale by whole units, with 6 WORK as the upper target:

```text
1 unit -> 3 WORK / 5 CARRY / 4 MOVE
2 units -> 6 WORK / 10 CARRY / 8 MOVE
```

The composition remains useful after maintenance because the creep can become a normal builder and later an upgrader.

### 13. Repairer spawn priority is source-local

Maintenance participates in the existing harvest source spawn flow and preserves the one-harvest-request-per-tick rule.

For the source currently being maintained, role priority is:

```text
miner
repairer
hauler
remote builder
```

A miner required to restore source production therefore remains more urgent than maintenance, while an active maintenance sweep takes priority over additional hauling capacity for that same source.

No replacement repairer is requested while a maintenance repairer is alive.

### 14. Remote construction also uses a monotonic cursor

Remote construction no longer repeatedly scans the whole path to count active road construction sites or rediscover the next builder target.

`constructionRoadIndex` identifies the current infrastructure position. Construction handles one current target at a time:

```text
road exists
  -> decrement constructionRoadIndex

road construction site exists
  -> keep it as the current builder target

road and site both missing
  -> create the site and keep it as the current builder target

room unseen
  -> retain the current index until vision is available
```

The previous three-site-ahead construction optimization is removed.

Construction and maintenance use separate cursors because they have separate lifecycles. They do not introduce a generic infrastructure-progress framework or a large path cache.

## Reasons

### Source readiness is a useful activation gate

Road maintenance only has value when the source is actually supported by the colony economy. Requiring current hauling readiness before starting a new maintenance cycle prevents infrastructure work from competing with the hauling recovery that makes the remote productive.

Keeping an already-active maintenance cycle independent of later readiness changes prevents transient worker replacement from interrupting work that has already been committed.

### Recent readiness bounds the maintained infrastructure set

The harvest plan may outlive practical use of a remote. `lastReadyTick` provides a cheap operational signal that the source has actually been used recently without introducing another remote lifecycle state.

### A colony-wide sweep amortizes the creep cost

Remote road decay is slow enough that permanent source-specific repairers are unnecessary. Waiting for a meaningful trigger and then sweeping several paths makes better use of spawn time and of the repairer's remaining lifetime.

### Hysteresis prevents maintenance churn

A low trigger threshold avoids frequent spawning. A high finish threshold lets one maintenance cycle restore enough health that another cycle should not be needed soon.

Forward-only sweep progress ensures that ordinary decay during the same cycle does not defeat that hysteresis.

### Repair plus movement reduces travel overhead

Repair range is three tiles and repair does not conflict with movement. Starting work as a damaged road enters range lets the repairer use travel ticks productively and only stop when the road still needs additional work at close range.

### Cursor-based progress is simpler than infrastructure caching

Construction and active maintenance already have deterministic directions through planned source paths. Persisting only the current source/index makes normal work proportional to actual forward progress without maintaining another cache of structure IDs or path state.

The only full source-path scan left in maintenance is the intentionally infrequent 100-tick idle inspection.

## Consequences

- Remote maintenance has one colony-level active lifecycle rather than one lifecycle per source.
- `lastReadyTick` and `nextMaintenanceTick` are persistent source operational history.
- Maintenance spawning is rare and bursty rather than continuous.
- A dead repairer is replaced only after death, continuing from the persisted cursor.
- Roads belonging to long-unused remotes naturally fall out of future sweeps.
- A completed source cannot re-enter the same maintenance sweep merely because it decays below 90% again.
- Repairers can repair while approaching the next damaged road and move immediately after a finishing repair.
- Missing remote roads and containers are rebuilt directly by the maintenance repairer.
- Maintenance consumes source energy through a simple carry-capacity reservation but does not alter steady-state hauling capacity estimates.
- Surviving maintenance workers are reused by normal build / upgrade policy.
- Remote construction and active maintenance avoid repeated whole-path scans by using separate monotonic cursors.
