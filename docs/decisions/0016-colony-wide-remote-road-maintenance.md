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

That lifecycle worked well and remains the starting point for v2. The rewrite should preserve the useful behavior while avoiding repeated full-path scans and allowing repair and movement in the same tick when possible.

A source can remain present in the harvest plan after its infrastructure stops seeing meaningful use. Maintenance therefore also needs a way to distinguish recently active remote infrastructure from stale roads that should be allowed to decay.

## Decision

### 1. Remote road maintenance is one colony-wide sweep

Remote road maintenance belongs to colony harvest infrastructure. It is not a source-local operation and does not maintain one dedicated repairer per source.

When maintenance becomes active, the colony maintains one sweep through eligible remote source paths. One repairer is spawned first. If that creep dies before the sweep finishes, another repairer may be spawned to continue the same maintenance cycle.

When the sweep finishes, surviving maintenance repairers become normal builders. Existing build policy may then convert those builders to upgraders when there is no construction work.

### 2. Starting maintenance requires a currently ready source

A source may start a new maintenance cycle only when all of the following are true:

```text
remote source
roadsEstablished
our reservation
sourceReady now
maintenance inspection is due
```

The existing harvest sourceReady result is the readiness gate. A source that is temporarily not ready does not trigger a new maintenance cycle.

If inspection is due but sourceReady is false, the inspection remains due rather than being postponed. The source may therefore trigger maintenance as soon as it becomes ready again.

Once maintenance has started on a source, a later loss of sourceReady does not interrupt that source's current maintenance work.

### 3. Record the last tick each source was ready

Persistent remote construction / infrastructure state records:

```ts
lastSourceReadyTick?: number
```

Whenever the existing sourceReady condition is true, update this field to the current tick.

This timestamp is used to prevent an active maintenance sweep from maintaining remote roads that remain in planning data but have not been used recently.

### 4. Active sweeps include recently used current remote sources

After a maintenance cycle has started, the next source is eligible when it:

```text
is a remote source in the colony's current harvest plan
has roadsEstablished
was sourceReady within the last CREEP_LIFE_TIME
```

The recent-use window is therefore initially one normal creep lifetime, 1500 ticks.

A source that has disappeared from the current harvest plan is not considered. No persistent snapshot of sweep source IDs is created.

Eligibility is checked when moving to the next source. Once work on a source has begun, that source is finished even if its lastSourceReadyTick ages beyond the recent-use window while the repairer is working on it.

The current sourceReady signal and our-reservation requirement are entry conditions for starting a new maintenance cycle, not requirements that must remain true throughout the active sweep.

### 5. Use 30% / 90% hysteresis

While maintenance is idle, an eligible due source can trigger maintenance when its planned infrastructure contains a serious problem such as:

```text
planned road at or below 30% hits
missing planned road
missing source container
```

Normal source-container wear is primarily handled by miners. The maintenance system is responsible for recovering missing infrastructure and for road maintenance.

Once a maintenance cycle is active, the repair target for roads is 90% hits.

Thus the intended hysteresis is:

```text
idle:
  do not spawn maintenance for ordinary wear
  trigger at <= 30% or missing infrastructure

active:
  restore encountered roads to >= 90%
  then continue the sweep
```

This makes maintenance infrequent while making each spawned repairer useful across multiple remote paths.

### 6. A completed source is not revisited during the same sweep

The maintenance sweep has forward progress through the colony's existing source order.

The first source is the first due source where inspection discovers a trigger condition. After that source is completed, maintenance proceeds to later eligible sources in the existing order, wrapping as needed so the cycle can cover the colony's eligible remote sources once.

Do not repeatedly rescan every source on every tick, and do not return to a source already completed in the current maintenance cycle.

This prevents normal decay after repair from causing oscillation. For example, a road repaired to 90% may fall to 89.x% while later sources are being processed; that does not send the current sweep back to the earlier source. A future maintenance cycle will not start again until the normal trigger condition is reached.

No damage score, distance score, or global best-source search is used. The next eligible source encountered in the existing source order is selected.

### 7. Repair while moving whenever one repair intent is enough

Repair and movement intents may occur in the same tick.

For a repairer with active WORK count W:

```text
repairPower = W * REPAIR_POWER
targetHits = road.hitsMax * 0.9
missingToTarget = targetHits - road.hits
```

If:

```text
missingToTarget <= repairPower
```

the repairer issues the repair and continues moving along the path in the same tick.

If more than one repair intent is required to reach the 90% target, the repairer stays in range and continues repairing until the target is reached, then resumes movement.

The stop condition is therefore based on the remaining damage to the 90% finish threshold, not on total lost hits and not on a fixed two-repair threshold.

Path processing should advance monotonically. Already passed path positions are not repeatedly searched for damage during the same source pass.

### 8. Reserve source energy for the repairer

While a maintenance repairer is assigned to a source and may refill from that source, reserve energy against that source for the repairer's carry capacity, analogous to the existing remote-builder reservation.

This protects the repairer's expected refill from being simultaneously treated as available hauling supply.

Maintenance is intermittent and short-lived relative to steady-state hauling, so it does not need the remote-builder carry-equivalent calculation. The maintenance worker's temporary energy reservation is sufficient.

### 9. Maintenance repairers reuse the remote-builder body shape

The current remote-builder unit is a suitable maintenance body:

```text
3 WORK
5 CARRY
4 MOVE
750 energy
```

It has enough MOVE to travel at road speed while loaded, substantial carry capacity for a maintenance sweep, and enough WORK to repair without excessive stopping.

The maintenance body may scale by whole units, with 6 WORK as the current intended upper WORK target:

```text
1 unit -> 3 WORK / 5 CARRY / 4 MOVE
2 units -> 6 WORK / 10 CARRY / 8 MOVE
```

The composition also remains useful after maintenance because the creep can be converted to a normal builder and later to an upgrader through existing colony policy.

### 10. Maintenance should also remove repeated remote-build path lookup

Remote construction and maintenance both need to inspect planned container / road positions. Their implementation should avoid independently rescanning whole source paths every tick.

The maintenance implementation should therefore introduce or reuse a focused infrastructure-progress representation so that:

- an idle established source pays only the cheap maintenance due/readiness checks;
- an active source advances through its path rather than restarting a full scan each tick;
- remote construction can use the same progress-oriented lookup instead of repeatedly searching the full path for its next target.

The exact representation is intentionally left to implementation design, but the goal is to make path work proportional to actual construction or maintenance progress rather than to total planned path length every tick.

## Reasons

### Source readiness is a useful activation gate

Road maintenance only has value when the source is actually supported by the colony economy. Requiring current source readiness before starting a new maintenance cycle prevents infrastructure work from competing with the miner / hauler recovery that makes the remote productive.

Keeping an already-active maintenance cycle independent of later sourceReady changes prevents transient worker replacement from interrupting work that has already been committed.

### Recent readiness bounds the maintained infrastructure set

The harvest plan may outlive practical use of a remote. lastSourceReadyTick provides a cheap operational signal that the source has actually been used recently without introducing another remote lifecycle state.

### A colony-wide sweep amortizes the creep cost

Remote road decay is slow enough that permanent source-specific repairers are unnecessary. Waiting for a meaningful trigger and then sweeping several paths makes better use of spawn time and of the repairer's remaining lifetime.

### Hysteresis prevents maintenance churn

A low trigger threshold avoids frequent spawning. A high finish threshold lets one maintenance cycle restore enough health that another cycle should not be needed soon.

Forward-only sweep progress ensures that ordinary decay during the same cycle does not defeat that hysteresis.

### Repair plus movement reduces travel overhead

Most road damage encountered during a sweep should not require the repairer to stop. Using movement and repair intents together allows the worker to traverse lightly damaged sections while repairing them.

### Simple source ordering avoids repeated global scans

The colony already has a deterministic source order. Reusing it removes the need for damage ranking or route optimization and permits a cursor-style implementation that only inspects the current source.

## Consequences

- Remote maintenance has one colony-level active lifecycle rather than one lifecycle per source.
- lastSourceReadyTick becomes persistent source infrastructure metadata.
- Maintenance spawning is rare and bursty rather than continuous.
- A maintenance worker can continue through temporary sourceReady loss once work has started.
- Roads belonging to long-unused remotes naturally fall out of future sweeps.
- A completed source cannot re-enter the same maintenance sweep merely because it decays below 90% again.
- Repairers may repair while moving when the current repair intent is enough to finish the road.
- Maintenance consumes source energy through a simple carry-capacity reservation but does not alter steady-state hauling capacity estimates.
- Surviving maintenance workers are reused by normal build / upgrade policy.
- Remote construction and maintenance should converge on a cursor/progress-based infrastructure lookup rather than independent full-path scans.

## Open implementation decisions

The following details are deliberately not fixed by this record yet:

- the exact maintenance inspection interval / nextMaintenanceTick policy;
- the exact persistent fields used to represent the active colony-wide sweep and its current source/path progress;
- how missing road and missing container construction sites are scheduled during maintenance;
- whether replacement repairers should be requested only after the current repairer dies or pre-spawned using a replacement lead time;
- the exact energy-fetch order between colony storage/logistics, dropped remote energy, and source containers;
- how construction and maintenance share the infrastructure-progress representation in code without adding unnecessary abstraction.
