# Intel persistence, bootstrap, and Explore topology

Status: accepted
Date: 2026-09-23
Supersedes: parts of [0013](0013-scouting-intel-and-exploration.md)

## Context

ADR 0013 established the separation between passive world intel and autonomous scouting policy, but several implementation details changed while the first vertical slice was built.

The important changes were:

- room intel was split by mutability rather than stored as one segment-backed object;
- simplicity was preferred over preserving observations during the few ticks after a global reset;
- segment activation order became relevant because base plans, source data, and room intel share the ten active-segment slots;
- Explore was widened beyond the original 1/3/5 normal-room-only proposal;
- the room graph and current Explore candidate set became large enough that recomputing topology or route targets every tick would be wasteful.

This record captures the implemented direction after those changes.

## Decision

### 1. Room intel has one merged public model but two persistence classes

Consumers use a merged `RoomIntel` model and do not need to know how its fields are persisted.

Internally, intel is split into:

- **static intel**, stored in RawMemory segments;
- **dynamic intel**, stored in Memory.

Static intel contains room facts that are treated as immutable for normal bot operation:

- source IDs and positions;
- mineral IDs, positions, and mineral types;
- controller ID and position;
- keeper-lair positions.

Dynamic intel contains small observations that change over time:

- `lastSeen`;
- controller owner and RCL;
- controller reservation and its absolute end tick.

Strategic experience, player behavior, harassment history, expansion scores, and other decisions or learned interpretations do not belong in RoomIntel merely because they reference a room.

The general ownership rule is:

```text
immutable observed room facts   -> Segment
small mutable room observations -> Memory
strategic history/experience    -> separate Memory domains
recomputable derived values     -> Heap
```

### 2. Static intel uses eight sharded segments

Room static intel uses segment IDs 16 through 23. Rooms are assigned to a shard by a stable hash of room name.

Each shard stores:

```ts
interface RoomStaticIntelSegment {
  version: 1
  mineralTypes: MineralConstant[]
  rooms: Record<string, PackedRoomStaticIntel>
}
```

The mineral-type array is append-only because packed room records refer to mineral types by index.

Static room records are compacted with the vendored UTF-15 codec. Source, mineral, and keeper-lair counts are format invariants with supported values 0 through 4. Object IDs and room coordinates are packed rather than stored as verbose JSON objects.

Decoded static intel may be cached in heap for the lifetime of the global.

### 3. Intel is globally gated until all static-intel shards are loaded

The intel subsystem does not try to preserve or queue observations made while its static segments are still loading after a global reset.

`roomStaticIntelStore` requests all eight intel shards and becomes ready only when all eight are loaded. Until then:

- visible-room intel refresh is skipped;
- Explore candidate generation returns no work;
- scouting that depends on intel waits.

Losing a few ticks of scouting or room refresh after a global reset is an acceptable trade for substantially simpler state handling. There is no pending-write queue, partial-ready state, or observation-wins merge path.

### 4. Segment bootstrap priority follows gameplay importance

The segment manager remains a simple first-requested, first-activated mechanism with a maximum of ten active segments.

Bootstrap priority is expressed by store call order rather than by adding a segment scheduler:

```text
BasePlan
  -> SourceData
  -> RoomIntel
```

At the start of a tick:

1. required owned-room base-plan shards are requested;
2. required owned-source data shards are requested;
3. room-intel shards request the remaining activation slots.

Segments already loaded into heap no longer consume future activation requests during the same global lifetime, so lower-priority shards naturally become available over subsequent ticks.

BasePlan and SourceData do not require whole-store readiness; their consumers already tolerate individual shards loading. RoomIntel deliberately requires all eight shards before becoming ready.

### 5. Explore topology is colony-relative BFS to depth 17

Explore uses actual room exits from `Game.map.describeExits()` through `getAdjacentRooms()`.

For each colony, BFS produces rooms grouped by graph depth out to depth 17. The result is cached in heap for the lifetime of the colony/global and is periodically removed when the colony no longer exists.

The topology cache stores only rooms by depth. Temporary BFS bookkeeping such as room-to-depth maps is discarded after construction.

Explore horizons are:

```text
1, 3, 5, 9, 13, 17
```

Candidate generation returns unknown rooms from the first horizon that still contains useful unexplored territory.

BFS may traverse every room type. Active Explore targets include:

- normal rooms;
- keeper rooms;
- center rooms.

Highway rooms are traversable and may gain intel incidentally, but are not active Explore targets. Time-sensitive highway resource discovery remains part of future Resource scouting.

### 6. Exploration checks observation state without decoding full static intel

Explore frequently needs only one fact: whether a room has been observed before.

`intelStore.has(roomName)` answers this from dynamic Memory rather than decoding and merging the corresponding static-intel record. This keeps candidate scans over hundreds of rooms cheap.

### 7. Target choice belongs to scouter execution, not Explore topology

`explore.ts` answers which rooms are currently valid Explore candidates.

A scouter chooses one concrete target from those candidates using multi-target room routing from its current position. The selected target room is kept in per-creep runtime state so route target selection is not repeated every tick.

The current target remains valid until room intel exists for that room. Movement path caching remains the responsibility of the movement capability; scouting caches only the target room.

Because a scout may be on the opposite edge of the colony's depth-17 exploration area from the next candidate, target selection allows room routes longer than the colony-relative exploration radius.

## Reasons

- Static room geometry and resource identity scale to thousands of rooms but almost never change, making segments appropriate.
- Mutable owner/reservation observations are tiny and simple to update in Memory.
- A merged public model prevents persistence details from leaking into remote, expansion, combat, or other consumers.
- Accepting a short global-reset pause removes pending writes, partial readiness, and several failure cases.
- Economy-critical segment data should become available before scouting data after reset.
- Cached BFS topology avoids rebuilding the same radius-17 room graph for every target decision.
- Horizon-based candidate generation keeps exploration broad around a colony without forcing strict BFS visit order.
- Separating candidate generation from scouter target choice keeps autonomous exploration policy distinct from worker execution.

## Consequences

- Global reset may delay intel refresh and scouting for several ticks depending on how many higher-priority segment shards must first be activated.
- Dynamic Memory is the authoritative cheap test for whether a room has ever been observed.
- Static intel is created only on first observation and then reused from segments.
- Explore can operate over a much larger radius without recomputing topology every tick.
- The next implementation step is to complete scouter movement and colony scout spawning, then validate autonomous exploration in game.
- Watch, Resource, observer allocation, and generic on-demand vision remain deferred.

## Differences from ADR 0013

ADR 0013 remains useful for the original responsibility split and the four conceptual scouting purposes, but the following implementation details are superseded:

- intel is not stored as one segment-backed object;
- observations during static-segment loading may intentionally be skipped;
- Explore horizons are not limited to 1/3/5;
- keeper and center rooms are active Explore targets;
- the implemented Explore radius extends to room-graph depth 17.
