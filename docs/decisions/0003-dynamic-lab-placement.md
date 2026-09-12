# Dynamic lab placement

Status: proposed; not yet implemented
Date: 2026-09-12

## Context

The old fixed lab stamp is no longer the target for V2.

The current planner already implements:

- selected terrain regions;
- controller-area selection and upgrade chains;
- the small core around storage;
- `corePlan.roads` as the road frontier of that core;
- a merged source/mineral resource tree returned by `planResourceTree()`.

There is no longer an explicit logistics tile named `A` in the implemented core. The current resource planner starts its Dijkstra map from every tile in `corePlan.roads`, and `ResourceTreePlan.roads` contains only the additional resource roads beyond those roots.

Therefore lab planning should be based on the actual implemented road geometry rather than reintroducing the old `A` abstraction.

The important lab properties are:

- valid 2-input / 8-output reaction geometry;
- short service-network distance from the core road frontier;
- explicit creep reachability;
- minimal additional lab-only service roads;
- compatibility with upgrade chains, resource roads, later rampart access, and extension packing.

Do not add a weighted lab-layout score unless a separate design decision justifies it.

## Current implementation boundary

As of this decision update, there is no `planLabs.ts` in `src/capabilities/basePlanning/` and `planBase()` stops after calling `planResourceTree()`.

This record therefore describes the next implementation stage. Statements below are intended design, except where they explicitly describe already implemented core/resource behavior.

## Terminology

- **core road frontier**: the tiles in `corePlan.roads`. These are the current roots of the resource-road planner and will also be distance-zero roots for lab service distance.
- **resource tree**: `resourceTree.roads`, the additional merged roads connecting the core road frontier to source/mineral work tiles.
- **base service network**: `corePlan.roads + resourceTree.roads`.
- **service network variant**: the base service network plus zero or more proposed lab-service-branch tiles.
- **lab service branch**: a short connected set of additional walkable/road tiles grown from the current service network only to make a better lab layout possible.
- **input labs**: the two reagent labs.
- **output labs**: the eight reaction labs.
- **service distance**: the shortest number of service-network steps from any core-road-frontier tile to a service tile. This is not the terrain-weighted `5/6` cost used by `planResourceTree()`.
- **lab service distance**: the minimum service distance among reachable service tiles adjacent to that lab.
- **max service distance**: the maximum lab service distance among all ten labs in one complete layout.

## Decision

### 1. Start from the implemented road network

The initial lab service network is:

```text
corePlan.roads
    + resourceTree.roads
```

`ResourceTreePlan.roads` does not replace the core roads; both sets are required.

For lab logistics, build a unit-cost distance map restricted to this service network:

```text
all corePlan.roads = distance 0
adjacent service tile = distance 1
next service tile = distance 2
...
```

A multi-source BFS or `dijkstraMap()` with cost `1` and `canVisit = serviceMask` is sufficient.

This distance is deliberately different from resource-road planning cost. Resource planning currently uses plain `5` and swamp `6` to choose roads. Lab service distance measures creep travel along the road/service graph after that geometry has already been chosen.

### 2. Reserve occupied and protected geometry before collecting lab candidates

Build a reservation mask before lab search.

At minimum, labs and new lab-service roads must respect:

- terrain walls;
- storage;
- terminal;
- manager tile;
- first spawn;
- core link;
- all upgrade-chain tiles that are still reserved;
- controller;
- sources;
- mineral;
- other already committed planner geometry.

Lab structures should also remain inside the selected base regions. The planner should fail or revisit an earlier candidate rather than silently place labs outside the selected area.

Service-network tiles are always reserved as walkable and may never become lab tiles.

### 3. Collect lab candidates from the current reachable service network

A lab candidate is a buildable, unreserved tile at Screeps range 1 from at least one reachable service-network tile.

For each unique candidate record at least:

```ts
interface LabCandidate {
  index: number;
  coordinate: RoomCoordinate;
  serviceDistance: number;
}
```

where `serviceDistance` is the minimum distance of its adjacent reachable service tiles.

A tile adjacent to several service tiles is still one candidate.

For deterministic and search-friendly iteration, candidates may be ordered by:

1. smaller `serviceDistance`;
2. stable room index.

This ordering is an iteration rule, not an additional layout objective.

### 4. Input labs are unordered pairs of lab candidates

Enumerate each unordered pair exactly once:

```ts
for (let i = 0; i < candidates.length - 1; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const inputA = candidates[i];
    const inputB = candidates[j];
  }
}
```

Do not add aesthetic input rules such as requiring the two inputs to be adjacent, diagonal, symmetric, or on opposite sides of a road.

The pair is useful only if it can geometrically support eight distinct output labs.

### 5. Mathematical pruning for input pairs

Screeps range is Chebyshev distance. For two input labs with

```text
dx = abs(inputA.x - inputB.x)
dy = abs(inputA.y - inputB.y)
```

each input has a `5 x 5` range-2 square. If `dx <= 4` and `dy <= 4`, the number of tiles in the intersection of those two squares is:

```text
intersection = (5 - dx) * (5 - dy)
```

When the two inputs are within range 2 of each other, both input tiles themselves lie inside that intersection but cannot be output labs. Therefore the theoretical maximum number of distinct output positions is:

```text
inputRange = max(dx, dy)
inputPenalty = inputRange <= 2 ? 2 : 0
maxGeometricOutputs = intersection - inputPenalty
```

An input pair can be rejected immediately when:

```text
maxGeometricOutputs < 8
```

This gives a stronger and correct condition than merely checking whether the two range-2 squares intersect.

In particular, the maximum possible Screeps range between the two input labs is **3**.

At range 3, only near-axis offsets can support eight outputs in open geometry:

```text
(3, 0), (0, 3), (3, 1), (1, 3)
```

For example:

```text
(3, 0): (5 - 3) * (5 - 0) = 10 possible output tiles
(3, 1): (5 - 3) * (5 - 1) = 8 possible output tiles
(3, 2): (5 - 3) * (5 - 2) = 6 -> impossible
(3, 3): (5 - 3) * (5 - 3) = 4 -> impossible
```

A useful non-obvious case is `(2, 2)`: the raw intersection is `9`, but both input tiles lie in that intersection, leaving only `7` possible output positions, so the pair is impossible even before terrain/reservations are considered.

This mathematical test is only an early rejection test. Actual output candidates must still be checked against terrain, reservations, and service reachability.

### 6. Output candidates are the common range-2 lab candidates

For a surviving input pair, an output candidate must satisfy:

```text
candidate != inputA
candidate != inputB
getRange(candidate, inputA) <= 2
getRange(candidate, inputB) <= 2
```

and it must already be a valid lab candidate for the current service-network variant.

A complete layout requires at least eight such candidates.

Because the objective for a fixed service-network variant is to minimize the worst lab service distance, there is no need to enumerate every `C(n, 8)` output subset.

For one input pair:

1. collect all valid common output candidates;
2. order them by `serviceDistance`, preserving stable order for ties;
3. take the first eight.

Those eight minimize the output contribution to `maxServiceDistance` for that input pair.

No output-shape compactness score is currently justified.

### 7. Reachability is a hard constraint

Reaction geometry alone is not enough.

The service network must contain a connected reachable component from the core road frontier, and every accepted lab must be adjacent to that reachable component.

The construction order should make the earlier prototype failure impossible:

```text
1. build service-network variant
2. mark every service tile as reserved/walkable
3. compute reachable service distances
4. collect lab candidates only beside reachable service tiles
5. choose inputs/outputs
6. validate all ten labs again before accepting
```

A lab may never occupy a branch tile. This prevents a lab from blocking the service path to downstream labs.

### 8. Service branches are searched before final lab positions are committed

Do not choose ten lab positions first and then attempt to connect them with a branch.

A branch changes:

- which lab tiles are serviceable;
- each candidate's service distance;
- which input pairs are possible;
- which outputs are reachable.

Therefore each branch proposal creates a new service-network variant, and the full lab search is rerun against that variant:

```text
base service network
    -> collect candidates
    -> input-pair search
    -> output search

base + branch variant 1
    -> collect candidates again
    -> input-pair search again
    -> output search again

base + branch variant 2
    -> ...
```

The branch is part of the search space; it is not post-processing for an already selected lab cluster.

### 9. Branch generation uses hard validity, not directional heuristics

The initial implementation should generate short connected branch candidates from reachable service tiles.

A proposed new branch tile must at least be:

- inside the room;
- inside the selected regions;
- non-wall terrain;
- not occupied/reserved by fixed planner geometry;
- not a lab tile, because labs have not been selected yet;
- connected to the existing service network or the preceding tile of the same branch.

All eight Screeps movement directions may be considered.

Do not initially encode preferences such as:

- diagonal branches are better;
- north/east/etc. is preferred;
- the branch should point toward open space;
- a specific visual shape is preferred.

The lab result should determine whether a branch direction is useful.

A branch may touch or reconnect to an existing service road. Loops are not inherently invalid. Branch cost is the number of **unique new service-road tiles**.

Prototype work suggests a small search depth around `0-3` new tiles is usually enough. A first implementation may use `3` as a bounded experimental cap, but the production maximum remains an empirical tuning question rather than a permanent geometric rule.

### 10. Layout selection is lexicographic

The primary objective is:

```text
minimize maxServiceDistance
```

The secondary objective is:

```text
minimize unique added lab-service-branch tiles
```

Remaining ties preserve stable deterministic iteration order.

Thus:

```text
branch 0, max distance 4
```

loses to:

```text
branch 1, max distance 2
```

while:

```text
branch 1, max distance 2
```

beats:

```text
branch 2, max distance 2
```

Do not add a weighted score for compactness, symmetry, average distance, branch direction, or branch shape.

### 11. The search can be organized by distance layers

The lexicographic objective can be made explicit in the search order.

Conceptually:

```text
for maxDistance D from small to large:
    for addedBranchTileCount K from small to large:
        enumerate deterministic service-network variants
            with K unique new branch tiles
            that can matter within distance D

        search all valid input pairs and outputs

        if any complete layout exists:
            return the first stable result
```

This is equivalent to selecting by:

```text
min maxServiceDistance
-> min addedBranchTileCount
-> stable order
```

It also gives a useful manual interpretation of the algorithm:

> Starting from the core roads, grow the usable service distance outward one layer at a time. At each layer, ask whether ten reaction-valid labs fit with zero extra road, then one extra branch tile, then two, and so on.

The implementation does not have to use this exact loop structure if another implementation produces the same ordering, but this is the clearest reference model.

## Hand-reproducible procedure

For debugging one room manually:

1. Draw `corePlan.roads` and label them service distance `0`.
2. Draw the connected resource roads and label their shortest service distances `1, 2, 3, ...` from the core-road frontier.
3. Choose a current maximum service distance `D`.
4. Mark every valid buildable tile adjacent to reachable service tiles at distance `<= D`.
5. Number those lab candidates.
6. Try unordered input pairs.
7. Reject a pair immediately if its theoretical `maxGeometricOutputs < 8`.
8. For surviving pairs, count actual candidates within range 2 of both inputs.
9. If at least eight exist, select the eight with the smallest service distances.
10. If no layout exists, try short branch variants and repeat candidate/input/output search from the beginning.
11. Increase `D` only after all cheaper branch counts at the current distance have failed.

This manual procedure should produce the same preference order as the implementation.

## Suggested implementation shape

Keep the first implementation in one file rather than introducing abstractions before they are needed:

```text
src/capabilities/basePlanning/planLabs.ts
```

Suggested public result:

```ts
export interface LabPlan {
  inputLabs: [RoomCoordinate, RoomCoordinate];
  outputLabs: RoomCoordinate[];
  serviceRoads: RoomCoordinate[]; // only new lab-specific roads
}
```

Suggested internal responsibilities:

```text
planLabs(...)
buildReservedMask(...)
buildServiceMask(...)
buildServiceDistanceMap(...)
collectLabCandidates(...)
findBestLabLayout(...)
generateServiceBranches(...)
chooseBetterLabLayout(...)
```

Do not split these into additional utility modules until reuse or complexity justifies it.

Downstream mandatory roads can then be composed explicitly as:

```text
corePlan.roads
+ resourceTree.roads
+ labPlan.serviceRoads
```

## Relationship to the rest of the base planner

The current implemented and intended sequence is:

```text
selected regions                         implemented
    -> controller area / upgrade chains implemented
    -> core                              implemented
    -> merged resource tree              implemented
    -> dynamic labs                      next stage
    -> expected rampart access           proposed
    -> extension packing                 proposed
```

Labs should be placed before extension packing so extensions treat lab structures and lab service roads as reserved/mandatory geometry.

## Experimental observations

Earlier prototype testing on saved `shardSeason` room geometry suggested:

- forcing labs to use only existing resource roads is unnecessarily restrictive;
- a short one- or two-tile branch can move a complete cluster materially closer to the core;
- explicit reachability checks catch geometrically valid but operationally blocked layouts;
- short branch lengths around `0-3` tiles were sufficient in representative successful cases.

These observations came from prototype geometry and are not proof that the current core/resource implementation will have identical distributions. They should guide the first implementation, then be remeasured on current planner output.

## Alternatives considered

### Reintroduce a single explicit `A` tile

Rejected for the current implementation. The core and resource planner already use `corePlan.roads` as a multi-tile frontier. Adding a synthetic single root would make the documentation diverge from the implemented geometry again.

### Fixed lab stamp

Rejected. It wastes usable irregular terrain and can force roads or structures into poor positions when a reaction-valid dynamic shape exists nearby.

### Labs only adjacent to existing resource roads

Rejected. A short lab-service branch can create a significantly closer complete cluster.

### Choose labs first, connect afterward

Rejected. Service geometry determines candidate validity and distance, so the branch must be part of the search state before labs are committed.

### Minimize branch length first

Rejected. It can prefer a zero-branch layout far down a resource road over a much closer layout requiring one short branch.

### Enumerate all output subsets

Rejected as unnecessary for the current objective. For a fixed input pair and service network, selecting the eight common output candidates with the smallest service distances already minimizes the worst output service distance.

### Optimize a full lab-worker tour

Not adopted. The service-network abstraction already provides explicit movement geometry, and minimizing worst service distance is simpler to inspect and reproduce.

### Weighted compactness / distance score

Not adopted. The lexicographic priorities directly encode the desired gameplay properties without arbitrary coefficients.

## Consequences

- Lab geometry adapts to walls, core placement, upgrade reservations, and resource-road shape.
- The lab worker always has an explicit reachable service network.
- Labs remain close to the core even when a small dedicated branch is worthwhile.
- Service roads remain available as explicit geometry for later extension/rampart planning.
- Input-pair search is small enough to brute-force after strong mathematical pruning.
- Output selection does not require combinatorial subset search under the current objective.
- Planner visualization should distinguish core/resource roads, lab-service branches, input labs, and output labs clearly by tile.

## Open questions

The following remain intentionally unresolved:

- whether current-room testing justifies a production branch-depth cap other than the prototype value around `3`;
- whether eight output labs eventually need a tie-break beyond stable order;
- whether boost/unboost traffic should alter the objective in special room types;
- whether RCL-aware partial lab layouts should be derived from the final ten-lab plan or planned separately;
- how factory, power spawn, later spawns, and towers should compete for the remaining core neighborhood;
- whether later measured CPU requires additional pruning beyond the simple bounded search.

These should be resolved from current V2 planner output and measured behavior rather than by adding speculative weights.