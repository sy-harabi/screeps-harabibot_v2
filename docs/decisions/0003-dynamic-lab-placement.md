# Dynamic lab placement

Status: proposed
Date: 2026-09-12

## Context

The old fixed lab stamp is no longer the target for V2.

The planner already has a logistics core and a merged road network beginning at `A`, the external logistics root. Labs should reuse that network when possible, stay close to `A`, and remain serviceable by a creep without consuming excessive space or blocking important movement.

The important properties are therefore not a particular 10-lab shape, but:

- reaction geometry;
- short service distance from `A`;
- explicit creep reachability;
- minimal extra road/service tiles;
- compatibility with the resource and later extension/rampart road network.

Do not add a weighted lab-layout score unless a separate design decision justifies it.

## Terminology

- **A**: logistics root/access tile from the core plan.
- **resource lane/tree**: the merged shortest-path road network from `A` to source and mineral work tiles.
- **service network**: walkable tiles from which a lab worker can access labs. Initially this is the relevant resource-lane portion and may include an optional lab service branch.
- **lab service branch**: a short walkable branch grown from the existing service network when the resource lane alone does not support a compact lab cluster near `A`.
- **input labs**: the two reagent labs.
- **output labs**: the eight reaction labs.
- **service distance**: road/service-network distance from `A`, not raw Screeps range through arbitrary tiles.

## Decision

### 1. Generate the service network before choosing lab positions

Lab placement is driven by creep movement.

Start with the already planned resource road network as the initial service network:

```text
A -> resource road tree
```

Labs do not have to sit directly beside the resource lane. If the nearby lane geometry cannot support a good 10-lab layout, the planner may add a short walkable service branch from the lane:

```text
resource lane
      |
      +-- lab service branch
```

The branch exists to improve lab placement and serviceability, not to force a stamp shape.

All service-network tiles are reserved as walkable. A lab may never be placed on a service tile.

### 2. Lab candidates are buildable tiles adjacent to the service network

For the current service network, collect buildable, unreserved tiles at range 1 from any service tile.

Exclude at least:

- terrain walls;
- service-network tiles themselves;
- `S`, `T`, `M`, `A`, link, spawn, or other already occupied core tiles;
- controller, sources, and mineral;
- upgrade-chain tiles that must still remain available at the relevant RCL;
- other reserved planner geometry.

A tile may be adjacent to several service tiles; it is still one lab candidate.

### 3. Enumerate reaction-valid 2-input / 8-output layouts

Choose an unordered pair of input-lab candidates.

For that pair, an output candidate is valid only when it is within Screeps range 2 of both input labs:

```text
getRange(output, inputA) <= 2
getRange(output, inputB) <= 2
```

A full layout requires at least eight distinct output candidates in addition to the two input labs.

The planner then selects eight output labs from the valid set.

The current design intentionally does not assign a geometric score to a particular output shape. Remaining equal candidates should keep stable iteration order until a real need for another rule appears.

### 4. Reachability is a hard constraint

Reaction geometry alone is not enough.

Every one of the ten labs must be adjacent to at least one service-network tile that is actually reachable from `A` through the service network.

The planner must explicitly validate:

```text
A -> connected service network -> tile adjacent to every lab
```

This validation exists because an earlier prototype allowed a lab to occupy a generated service-branch tile. That could block the path and leave downstream labs nominally adjacent to the intended branch but unreachable in practice.

Therefore:

- service tiles are never lab candidates;
- service-network connectivity from `A` is checked after branch generation;
- all ten labs are checked again against the reachable service-network component before accepting a layout.

### 5. Proximity to A is the primary preference

A zero-branch layout far down a resource lane is not automatically better than a layout near `A` that needs one or two additional service tiles.

For every complete reachable lab layout, calculate the minimum service-network distance from `A` to a tile adjacent to each lab.

The primary layout metric is the worst of those ten values:

```text
maxServiceDistanceFromA
```

Choose layouts lexicographically:

1. minimize `maxServiceDistanceFromA`;
2. among equal results, minimize the number of added lab-service-branch tiles;
3. preserve stable iteration order for remaining ties.

This means the planner may intentionally add a short branch even when a branch-free layout is possible, if the branch keeps the entire lab cluster materially closer to `A`.

### 6. Branch growth starts from the existing lane and expands only as needed

The planner first tests the current resource service network.

If no suitable layout is found close enough to `A`, generate short simple service branches from reachable lane tiles and repeat the full lab search against the expanded network.

Conceptually:

```text
resource service network
    -> test lab layouts
    -> add short branch candidate
    -> rebuild lab candidates
    -> test reaction geometry
    -> validate reachability
```

The service branch is therefore part of the search space, while the lab positions are regenerated from the resulting service network.

The current prototype searches only short branches because the purpose is to keep labs near the beginning of the logistics network. Long lab-only corridors defeat that goal and should cause the planner to consider another core/road candidate instead.

## Selection outline

The intended search can be summarized as:

```text
for each short service-network variant near A:
    labCandidates = valid buildable neighbors of serviceNetwork

    for each input-lab pair:
        outputs = candidates within range 2 of both inputs

        if fewer than 8 outputs:
            continue

        choose 8 outputs

        if serviceNetwork is not connected from A:
            continue

        if any of the 10 labs is not adjacent to the reachable service network:
            continue

        record:
            maxServiceDistanceFromA
            addedBranchTileCount

choose lexicographically:
    minimum maxServiceDistanceFromA
    -> minimum addedBranchTileCount
    -> stable order
```

## Relationship to the rest of the base planner

The current intended order is:

```text
selected regions
    -> controller area / storage / upgrade chains
    -> core and A
    -> merged source/mineral resource roads
    -> dynamic labs near A
    -> expected rampart lanes
    -> extension packing
```

Labs are placed before extension packing because the extension planner treats already planned labs and their service tiles as reserved geometry.

The resource lane remains useful to later systems. A lab service branch is simply another road/service path that future extension packing may reuse when it lies inside the active growth area.

## Experimental observations

Testing against saved `shardSeason` room geometry showed several useful behaviors:

- forcing labs to use only the resource lane was unnecessarily restrictive;
- branch-free layouts often existed far from `A`, but a one-tile branch could move the entire cluster much closer;
- after changing the priority from branch length to `A` proximity, several rooms reduced their maximum lab service distance dramatically;
- explicit reachability validation caught layouts that looked valid geometrically but had a blocked service route;
- short branch lengths of roughly 0-3 tiles were sufficient in the representative successful cases tested so far.

These are observations from the prototype, not fixed scoring constants.

## Alternatives considered

### Fixed lab stamp

Rejected. It wastes usable irregular terrain and can force roads or other structures into poor positions even when a compact reaction-valid shape exists nearby.

### Labs only adjacent to the resource lane

Rejected. A short service branch can create a much better cluster without meaningfully complicating logistics.

### Minimize branch length first

Rejected. It preferred zero-branch layouts far down resource roads over much closer layouts near `A`.

### Optimize a full lab tour

A state-space search for the exact minimum creep tour touching all ten labs was considered but not adopted. The service-network abstraction already makes movement simple, and minimizing the worst service distance from `A` is much easier to reason about.

### Weighted compactness / distance score

Not adopted. The current ordered priorities directly represent the desired behavior and avoid arbitrary coefficients.

## Consequences

- Lab geometry is dynamic and can adapt to walls, roads, and the local core instead of forcing a stamp.
- The lab worker has an explicit connected service path rather than relying on incidental open tiles.
- Labs stay near the logistics root even when this requires a small dedicated branch.
- The road planner and lab planner must expose actual paths/service tiles, not only unordered tile sets.
- Planner visualization should draw the resource lane and lab service branch as connected paths and distinguish input/output labs.
- Downstream extension packing must reserve lab tiles and service tiles but may reuse the service road network where appropriate.

## Open questions

The following are not yet fixed:

- whether the eight output labs need an additional compactness tie-break after more room samples are inspected;
- the exact maximum lab-service-branch search depth used in production;
- whether special boost/unboost goals should alter lab placement in some room types;
- whether RCL-aware partial lab layouts should be generated separately or derived from the final 10-lab plan;
- how factory, power spawn, later spawns, and towers should interact with the lab/core neighborhood.

These should be decided from actual room layouts and measured logistics behavior rather than by adding speculative weights.