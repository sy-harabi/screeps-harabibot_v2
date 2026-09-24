# Scout movement and Source Keeper avoidance

Date: 2026-09-24
Related commits: `988d4f3`, `454d7b5`, `d63d92e`, `1d5da79`, `c095544`

## Goal

Finish the first autonomous Explore scout movement slice and stop scouts from repeatedly dying while crossing Source Keeper rooms.

The immediate goal was path-level safety inside Keeper rooms. Route-level preference against Keeper rooms was deliberately deferred so routing policy can be tuned later with real gameplay evidence.

## Starting point

Explore already produced colony-relative candidate rooms and each scout cached a concrete target selected through multi-target room routing.

Navigator already supported multi-room PathFinder searches and cached per-creep paths, but two practical problems remained:

- long routed searches could exhaust the default PathFinder operation budget;
- scouts could enter or cross Keeper rooms using paths computed without Keeper danger costs.

Room static intel already persisted source, mineral, and Keeper Lair positions, which made it possible to reuse the original bot's proven Source Keeper model without adding new persistent scouting state.

## Decisions

### Scale PathFinder work with the routed search area

The multi-room search operation budget now scales with the number of allowed rooms rather than relying on PathFinder's small default budget.

This addresses searches that were failing in otherwise reachable multi-room corridors simply because the search exhausted its operation budget.

### Keep route policy unchanged for now

Source Keeper avoidance is currently a path-level concern only.

Keeper rooms remain valid Explore targets and remain traversable. No additional room-route cost is applied yet. A route penalty can be introduced later if live results show that scouts should prefer modest detours around Keeper rooms.

### Use one boolean movement policy

The public movement option is intentionally small:

```ts
avoidSourceKeepers?: boolean
```

When enabled, Source Keeper danger tiles always receive cost 255. The danger range and cost are not currently configurable because the first consumer, Explore scouting, only needs strict avoidance.

### Model the Keeper's final position from static intel

The implementation follows the original bot's useful behavioral model:

```text
Keeper Lair
    ↓
nearby source or mineral
    ↓
terrain-weighted shortest approach
    ↓
resource-adjacent final position
```

For each Keeper Lair, the movement capability selects the nearest resource and uses a terrain-weighted Dijkstra map to identify the cheapest resource-adjacent final position. Plain tiles cost 1 and swamp tiles cost 5.

If multiple adjacent positions tie for the minimum distance, all tied positions are treated as possible Keeper positions.

All walkable tiles within range 3 of each predicted final position receive cost 255.

### Cache the completed Keeper CostMatrix

`sourceKeeperCosts.ts` owns a runtime cache containing the completed matrix:

```text
base room CostMatrix
        +
Source Keeper danger costs
        =
cached Source Keeper CostMatrix
```

The cache stores the base matrix reference used to build the completed matrix. A cached result is reusable while:

```ts
cached.baseMatrix === baseMatrix
```

This is only a reference-identity comparison. When room structures change, the base-cost module creates a new matrix object, so the Keeper matrix is rebuilt naturally.

If Keeper-room static intel is unavailable, the function returns the base matrix and does not create a completed Keeper-cost cache entry from incomplete information.

### Repath paths created before Keeper intel became available

A scout may calculate a path through an unexplored Keeper room before the bot knows its Keeper Lair positions.

Runtime timestamps make this case explicit:

```text
RoomStaticIntel.staticAvailableAt
MovementRuntime.pathCreatedAt
```

`staticAvailableAt` is runtime-only. It is set to `Game.time` when static intel is created from live vision or unpacked into the current runtime; it is not persisted in the static-intel codec.

When a creep with `avoidSourceKeepers` enters a Keeper room, movement compares:

```ts
pathCreatedAt < intel.staticAvailableAt
```

If true, the current path was created before that room's static intel was available. The bot does not scan the old path to decide whether it happens to be safe; it simply repaths once. The new search then uses the newly available Keeper CostMatrix.

This replaces more complicated alternatives such as storing blind Keeper-room sets or per-room validation state.

### Enable strict Keeper avoidance for Explore scouts

Explore scouts now call `moveCreep()` with:

```ts
avoidSourceKeepers: true
```

Target selection and room routing remain otherwise unchanged.

## Work completed

- Increased multi-room PathFinder `maxOps` according to the routed allowed-room count.
- Added `sourceKeeperCosts.ts`.
- Added static Keeper danger calculation based on Lairs, sources, minerals, terrain, and range 3.
- Added runtime caching for completed Source Keeper CostMatrices.
- Added `avoidSourceKeepers?: boolean` to movement/path options.
- Added path-policy tracking for cached paths.
- Added `MovementRuntime.pathCreatedAt`.
- Added runtime-only `RoomStaticIntel.staticAvailableAt`.
- Added automatic repathing when a Keeper-room path predates the room's available static intel.
- Enabled Source Keeper avoidance for Explore scouts.

## What we learned

- The original bot's Source Keeper pathing model remains useful, but its policy surface can be smaller in v2.
- Unknown-room safety is easier to express as a timestamp relationship than as additional per-room path-validation state.
- When new intel makes an old path potentially invalid, unconditional one-time repathing is simpler than scanning the cached path to prove it safe.
- Static Source Keeper geometry is a good cross-tick cache because the expensive part is stable while the base matrix can invalidate it cheaply through reference identity.
- Route preference and tile safety are separate concerns and do not need to be solved together.

## Result

Explore scouts can now traverse multi-room routes with a search budget proportional to the routed corridor and avoid the stable danger zones around Source Keepers when static intel is known.

If a scout discovers a Keeper room only after its path was created, movement detects that the static intel became available later and immediately rebuilds the path using Keeper-aware costs.

## Next step

Observe live scouts crossing several Keeper rooms and confirm that the static final-position model prevents deaths reliably. Only then decide whether route-level Keeper penalties or live Keeper-position overlays are necessary.
