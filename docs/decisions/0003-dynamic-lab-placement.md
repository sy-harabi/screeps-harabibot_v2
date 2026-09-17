# Dynamic lab placement

Status: implemented; initial bounded-search version
Date: 2026-09-13

## Context

V2 does not use the old fixed lab stamp. Lab placement is built on top of the geometry already selected by the base planner:

- selected terrain regions;
- controller-area selection and upgrade chains;
- the compact storage/core layout;
- `corePlan.roads` as the core road frontier;
- the merged source/mineral resource tree from `planResourceTree()`.

The base service network is:

```text
corePlan.roads
+ resourceTree.roads
```

Resource containers are deliberately excluded. They are occupied structure tiles, not walkable service-road tiles.

The planner should find a reaction-valid 2-input / 8-output lab layout that is close to the core, explicitly serviceable by creeps, and compatible with already committed geometry.

The current implementation intentionally avoids weighted scoring and broad branch-network optimization. The search order itself encodes the preference.

## Terminology

- **core road frontier**: every tile in `corePlan.roads`; these are service-distance roots.
- **base service network**: `corePlan.roads + resourceTree.roads`.
- **service distance**: shortest unit-cost distance along the current service network from any core-road-frontier tile.
- **lab service distance**: minimum service distance among reachable service tiles adjacent to a lab.
- **max service distance**: maximum lab service distance among all ten labs.
- **lab service branch**: one simple connected path of `1-3` new service-road tiles grown from an existing reachable service tile.
- **service-network variant**: the base service network plus zero or one lab service branch.

## Decision

### 1. Use the implemented road network directly

The service network starts from:

```text
corePlan.roads
+ resourceTree.roads
```

Service distance is computed with unit cost, not the `5/6` terrain costs used when constructing the resource tree.

```text
all corePlan.roads = 0
next connected service tile = 1
next = 2
...
```

`dijkstraMap()` with cost `1` and traversal restricted to the service mask is sufficient.

### 2. Reserve committed geometry before lab search

The lab planner builds a reservation mask for tiles that may not become a lab or a new lab-service road.

Current reservations include:

- controller;
- storage;
- all reserved upgrade-chain tiles;
- manager tile;
- first spawn;
- core link;
- sources and mineral;
- every resource container;
- the terminal and every tile at range `1` from the terminal.

The terminal range-1 area is intentionally kept free as an idle-creep parking zone.

Terrain walls and tiles outside the selected base regions are also invalid for new labs/branch roads, but are treated as terrain/planning-area validity rather than as fixed reserved structures.

Existing service roads remain walkable and may not become lab structures.

### 3. Collect lab candidates from reachable service tiles

A lab candidate is a buildable, unreserved tile at range `1` from at least one reachable service tile whose service distance is within the current cap `D`.

```ts
interface LabCandidate {
  readonly coordinate: RoomCoordinate
  readonly serviceDistance: number
}
```

If a candidate touches several service tiles, keep its minimum adjacent service distance.

Candidates are ordered deterministically by:

1. smaller `serviceDistance`;
2. stable room index.

This is iteration order, not a separate weighted objective.

### 4. Input labs are unordered candidate pairs

Enumerate each pair once:

```ts
for (let i = 0; i < candidates.length - 1; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    // input pair
  }
}
```

No aesthetic restriction is imposed on input orientation or symmetry.

### 5. Prune geometrically impossible input pairs

For two input labs:

```text
dx = abs(inputA.x - inputB.x)
dy = abs(inputA.y - inputB.y)
```

Their range-2 squares overlap in:

```text
intersection = (5 - dx) * (5 - dy)
```

when `dx <= 4` and `dy <= 4`.

If the inputs are themselves within range `2`, both input tiles occupy positions in that intersection and cannot be outputs:

```text
inputRange = max(dx, dy)
inputPenalty = inputRange <= 2 ? 2 : 0
maxGeometricOutputs = intersection - inputPenalty
```

Reject the pair when:

```text
maxGeometricOutputs < 8
```

Consequences:

- maximum possible input-lab range is `3`;
- `(3, 0)`, `(0, 3)`, `(3, 1)`, `(1, 3)` can still support eight outputs in open geometry;
- `(3, 2)` and `(3, 3)` cannot;
- `(2, 2)` has raw overlap `9`, but only `7` output positions remain after excluding both input tiles.

### 6. Output labs are the first eight common candidates

For a surviving input pair, an output candidate must:

```text
candidate != inputA
candidate != inputB
range(candidate, inputA) <= 2
range(candidate, inputB) <= 2
```

and already be a valid candidate for the current service-network variant and service-distance cap.

Candidates are already ordered by service distance and stable room index, so the first eight common candidates are used. No `C(n, 8)` subset search or compactness score is used.

### 7. Branches are committed before lab candidates are evaluated

Do not select ten labs first and connect them afterward.

For every branch proposal:

```text
base service mask
+ branch tiles
-> recompute service distance map
-> collect candidates again
-> search input pairs
-> search outputs
```

Because branch tiles are already part of the service mask, labs cannot occupy them. This makes the service road explicitly reachable before the lab layout is accepted and avoids layouts that later block their own access road.

### 8. A branch is one simple path of 1-3 new road tiles

The current implementation searches exactly one branch at a time.

```text
length 1: R-B
length 2: R-B-B
length 3: R-B-B-B
```

`R` is an existing reachable service tile and each `B` is a new service-road tile.

A branch tile must be:

- inside the room;
- inside a selected base region;
- non-wall terrain;
- not fixed/reserved geometry;
- not an existing service tile;
- not already used earlier in the same branch path.

All eight Screeps movement directions are allowed. No directional, symmetry, straight-line, or open-space heuristic is applied.

A branch may incidentally touch or reconnect to another existing service road. Variants that contain the same set of new road tiles are evaluated once.

### 9. Service-distance cap applies to the actual variant

Branch length and service distance are different quantities.

A three-tile branch can, for example, run alongside existing roads and have all three new tiles at small service distance. Therefore the planner does not assume:

```text
branch end distance = root distance + branch length
```

Instead it builds the complete service-network variant, recomputes the unit-cost service distance map, and rejects the branch if any of its new road tiles has:

```text
serviceDistance > D
```

Lab candidates are also restricted to adjacent service tiles with distance `<= D`.

### 10. Search order defines the objective

The planner searches distance layers from small to large.

For each service-distance cap `D`, it tries:

```text
0 new branch tiles
1 new branch tile
2 new branch tiles
3 new branch tiles
```

Within each branch length, variants are generated deterministically from room-index order and `NEIGHBOR_OFFSETS` order.

The first complete reaction-valid layout is returned immediately.

Conceptually:

```text
for D = 0 .. MAX_SERVICE_DISTANCE:
    try base service network
    if success: return

    for branchLength = 1 .. 3:
        enumerate valid single-path branches
        for each branch:
            require every branch tile serviceDistance <= D
            search lab layout
            if success: return
```

This gives the preference order:

```text
1. smaller max service distance
2. at the same distance, fewer added branch-road tiles
3. stable deterministic iteration order
```

No weighted score is used for compactness, symmetry, branch shape, average distance, or orientation.

### 11. Result shape

```ts
export interface LabPlan {
  readonly inputLabs: [RoomCoordinate, RoomCoordinate]
  readonly outputLabs: RoomCoordinate[]
  readonly serviceRoads: RoomCoordinate[]
}
```

`serviceRoads` contains only the new lab-specific branch roads. It is empty when the base service network already supports a complete layout.

Downstream mandatory roads are therefore:

```text
corePlan.roads
+ resourceTree.roads
+ labPlan.serviceRoads
```

Downstream reserved structure geometry must include:

```text
resourceTree.branches[].container
+ labPlan.inputLabs
+ labPlan.outputLabs
+ other committed structures
```

## Current implementation shape

The first implementation remains in one file:

```text
src/capabilities/basePlanning/planLabs.ts
```

The main responsibilities currently map to:

```text
planLabs(...)
findLabPlanWithBranch(...)
tryLabLayout(...)
findLabLayout(...)
canSupportEightOutputs(...)
collectLabCandidates(...)
buildServiceDistanceMap(...)
buildReservedMask(...)
```

The base service mask is short enough to build inline in `planLabs()` rather than through a separate helper.

Branch DFS generates a branch variant and evaluates it immediately instead of materializing every possible branch in an array. This allows the search to stop at the first success.

## Hand-reproducible search

For one room:

1. Draw `corePlan.roads` and label them distance `0`.
2. Draw `resourceTree.roads` and label shortest service distances from the core roads.
3. Mark resource containers and all other reserved geometry.
4. Mark the terminal range-1 parking zone as unavailable for new labs/branch roads.
5. Choose the current distance cap `D`.
6. Search the base service network for ten reaction-valid labs.
7. If it fails, try every valid single-path branch of length `1`.
8. Then try length `2`.
9. Then try length `3`.
10. For every branch, recompute actual service distances and reject it if any branch tile exceeds `D`.
11. For every surviving service-network variant, recollect candidates and rerun the input/output search.
12. Return the first success; only then increase `D` if all branch lengths failed.

## Relationship to the rest of the base planner

```text
selected regions                         implemented
    -> controller area / upgrade chains implemented
    -> core                              implemented
    -> merged resource tree + containers implemented
    -> dynamic labs                      implemented
    -> expected rampart access           proposed
    -> extension packing                 proposed
```

Labs remain before extension packing so extensions can treat lab structures and lab service roads as already committed geometry.

## Alternatives considered

### Fixed lab stamp

Rejected. It wastes usable irregular terrain and can force the whole base to conform to lab geometry.

### Labs only beside existing roads

Rejected. A short dedicated branch can produce a materially closer or otherwise feasible complete cluster.

### Choose labs first and connect afterward

Rejected. The service road must already exist in the search state so labs cannot block the route needed to service them.

### Enumerate arbitrary multi-branch networks

Not used in the initial implementation. It greatly enlarges the state space and complicates reachability/optimization for limited practical benefit. The bounded single-path branch is deliberately simpler and can be expanded later only if room testing shows a real need.

### Potential-service expansion map followed by road reconstruction

Not used. Lab structures and potential service roads interact: a geometrically valid lab cluster can occupy tiles needed to realize its later service route. Committing the short branch first keeps the invariant simple.

### Minimize branch length before service distance

Rejected. A far zero-branch layout should lose to a much closer layout requiring a short branch. Distance layer `D` is therefore the outer search loop.

### Weighted scoring

Not adopted. The explicit search order is easier to inspect, reproduce, and tune.

## Consequences

- Every accepted lab is adjacent to an explicitly reachable committed service network.
- Lab branch roads cannot later be occupied by labs.
- Search behavior is deterministic and easy to reproduce manually.
- Branch complexity is bounded: zero or one simple branch, with at most three new tiles.
- The first implementation may miss a room where the only good solution requires two separate branches or a more complex service-road tree.
- Such additional complexity should be added only if empirical room testing demonstrates the need.

## Open questions

- Is `MAX_BRANCH_LENGTH = 3` sufficient across representative rooms?
- Is the current `MAX_SERVICE_DISTANCE` cap appropriate?
- Does measured planner CPU require additional branch pruning?
- Do output labs eventually need a tie-break beyond service distance and stable index?
- Should special room types use different lab objectives for boost/unboost traffic?
- How should factory, power spawn, later spawns, and towers compete for the remaining core neighborhood?
