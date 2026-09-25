# Intel and Explore scouting foundation

Date: 2026-09-23
Related commits: `508ad08`, `9be05c6`, `791fd3b`, `0d1e8c2`, `641029a`, `7f628ec`, `dd3c3d8`, `7cfba39`, `3c292e0`, `4d0cf68`, `35cb538`, `f2715c2`, `8fd2961`, `ca73c40`, `86aedda`

## Goal

Build the world-intel foundation needed before remote mining, then start the first autonomous scouting purpose: Explore.

The intended result was not a full scout manager. The milestone was to establish clear state ownership, compact persistence, global-reset behavior, room-topology exploration, and enough target selection to make the next step straightforward.

## Starting point

The bot already had:

- RawMemory segment management;
- base-plan and source-data segment stores;
- runtime cache registration and cleanup;
- multi-room movement and traffic management;
- multi-target room routing support in Navigator.

The original HarabiBot had useful scouting behavior, but its intel and scouting code mixed observed world facts, strategic judgments, action history, and several different reasons for obtaining vision.

## Decisions

### Separate intel from scouting

Room intel is passive observed world state. Any source of vision may update it. Scouting decides where autonomous vision gathering is useful but does not own the observed facts.

Four scouting purposes were identified for future work:

- Explore;
- Watch;
- Resource;
- on-demand vision.

Only Explore is part of the current milestone.

### Split room intel by mutability

The first design considered one segment-backed room-intel object. During implementation this was changed to:

```text
RoomStaticIntel  -> RawMemory segments
RoomDynamicIntel -> Memory
merged RoomIntel -> public API
```

Static intel contains sources, minerals, controller identity/position, and keeper-lair positions. Dynamic intel contains last-seen time, ownership/RCL, and reservation state.

Reservation expiry is stored as an absolute tick rather than a relative `ticksToEnd` value.

Strategic experience and derived scores are intentionally excluded from RoomIntel.

### Compact static intel

Static intel is sharded across segment IDs 16-23 and packed with the already-vendored UTF-15 codec.

Source, mineral, and keeper-lair counts use the invariant range 0-4. IDs and coordinates are packed. Each static-intel shard owns an append-only mineral-type table used by packed room records.

Dynamic intel is stored as compact tuples in each room's `RoomMemory.intel`.

### Prefer simple global-reset behavior

An early design considered lazy loading and pending static writes so observations made during segment loading would never be lost.

This was rejected as unnecessary complexity. After a global reset, the intel subsystem simply waits until all eight static-intel shards are loaded. During that short interval, intel refresh and scouting that depends on intel stop.

### Prioritize economy segment bootstrap

The first readiness implementation requested all eight intel segments before colony stores, which would have consumed most of the ten segment activation slots immediately after reset.

Instead, request order now expresses bootstrap priority:

```text
BasePlan -> SourceData -> RoomIntel
```

The segment manager itself remains simple. Loaded shards stay available in heap, so lower-priority shards naturally load on later ticks.

### Explore breadth with cached BFS

Explore builds a colony-relative BFS from actual room exits to depth 17 and caches the rooms grouped by depth in heap.

Exploration horizons are:

```text
1, 3, 5, 9, 13, 17
```

The first horizon containing unexplored useful rooms supplies the candidate set.

Normal, keeper, and center rooms are active Explore targets. Highway rooms remain traversable but are not active Explore targets.

`intelStore.has(roomName)` checks dynamic Memory directly so candidate scans do not decode and merge static room intel.

### Separate candidate generation from target execution

`explore.ts` owns topology and candidate policy.

`scouter.ts` owns selection of the concrete target for one scout. It uses Navigator's multi-target room routing and keeps the chosen target room in per-creep runtime state so target routing is not repeated every tick.

Movement path caching remains the movement capability's responsibility.

## Work completed

- Added multi-target room routing support to Navigator.
- Added RoomIntel static/dynamic models and merge logic.
- Added compact dynamic Memory packing/unpacking.
- Added UTF-15 static intel codec.
- Added eight-shard static intel store with decoded heap cache.
- Added merged `intelStore` API and visible-room refresh in the main loop.
- Added global intel readiness gating.
- Added BasePlan and SourceData segment preloading ahead of RoomIntel.
- Added cached colony Explore BFS to depth 17.
- Added horizon-based unexplored candidate generation.
- Added cheap `intelStore.has()` observation checks.
- Added per-scout runtime target selection using multi-target routing.

## Problems encountered

### Segment readiness versus complexity

Trying to make room intel partially available during global-reset loading required pending writes and merge rules. The expected gameplay benefit was only a few ticks of extra scout/intel activity, so the complexity was not justified.

### Segment activation contention

Making all room-intel shards eager exposed that segment activation order matters. Intel should not delay base plans or owned-source data after reset.

### Explore radius versus routing

A depth-17 exploration radius does not imply a scout is always within 17 room hops of its next target. A scout can be near one edge of the explored area while the next useful target lies near the opposite edge, so concrete target routing must allow a larger route budget.

## What we learned

- Persistence should follow data lifecycle rather than forcing one storage mechanism on an entire domain.
- A merged public model can hide a static/dynamic persistence split cleanly.
- Accepting a small reset-time pause can remove substantial state-machine complexity.
- Segment request order is enough for current bootstrap priority; a generic priority scheduler is unnecessary.
- Large derivable topology is a good domain-owned heap cache when its lifecycle is clear.
- Explore policy and individual scout execution are separate responsibilities even though both live under scouting.

## Result

The bot now has a persistent room-intel foundation suitable for future remote, expansion, combat, and scouting consumers. Explore can derive and cache a large colony-relative search area, identify the current unexplored candidate band, and choose a concrete target for a scout without rerouting every tick.

The scouting vertical slice is not yet complete. `scouter.ts` currently selects targets, but scout movement, colony-level scout spawning/orchestration, and live autonomous exploration validation remain to be completed.

## Next step

1. finish scouter movement into the selected room;
2. maintain at most one Explore scout per colony and issue the scout spawn request;
3. connect scout execution to the colony/scouting runner;
4. validate that entering rooms refreshes intel and advances targets correctly;
5. then begin remote-mining selection using the collected RoomIntel.
