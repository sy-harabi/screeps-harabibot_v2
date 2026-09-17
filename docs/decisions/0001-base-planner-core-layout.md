# Base planner controller area and core layout

Status: implemented through resource-tree selection
Date: 2026-09-11
Updated: 2026-09-12

## Context

The V2 base planner establishes the controller area and permanent local core before building the rest of the room road network.

The current design goals are:

- reserve strong controller upgrade geometry before later structures consume it;
- use storage as the controller-side anchor from RCL4 onward;
- keep the local core small and deterministic;
- allow the small core to rotate and mirror with terrain rather than use a large bunker stamp;
- reject bad geometry explicitly instead of accumulating weighted heuristics;
- keep upgrade-chain tiles reserved for stationary upgraders;
- prefer a core that faces the selected base area after controller quality has been preserved.

The planner uses hard validity rules first and a short lexicographic preference order second. It intentionally avoids a large weighted score.

## Terminology

- **selected regions**: terrain regions chosen as the initial base area.
- **selected center**: the rounded center of mass of all tiles in the selected regions.
- **upgrade area**: selected-region tiles within controller range 3.
- **storage candidate**: a selected-region tile at controller range 4 with three adjacent upgrade roots.
- **upgrade roots**: the left, middle, and right upgrader tiles adjacent to a storage candidate.
- **upgrade chains**: up to three paths grown from those roots, with a maximum length of 6 per chain.
- **middle root**: the middle of the three upgrade roots. The vector `storage -> middleRoot` defines the forward direction of the core stamp.
- **core stamp**: a small local-coordinate template containing terminal, manager tile, first spawn, link, and core roads around storage.
- **manager tile**: the stationary logistics-creep position; it is not a structure.
- **mirror**: reflection of the core stamp across its forward axis before converting local coordinates to room coordinates.
- **core road frontier**: the tiles in `corePlan.roads`. The resource planner uses all of them as Dijkstra roots. There is no explicit single logistics tile `A` in the current implementation.
- **resource container**: the final range-1 tile selected for a source or mineral. It is blocked from later Dijkstra searches and is not part of the road tree.
- **resource branch**: the ordered road path from the core frontier to one resource container. Shared trunk roads may appear in several branch arrays.

## Current implemented pipeline

```text
terrain
    -> distance transform
    -> terrain regions
    -> selected regions
    -> selected center
    -> storage candidates at controller range 4
         -> require three upgrade roots
         -> generate upgrade chains
         -> compact outer chains
         -> assign upgrade-capacity tier
    -> for every controller-area candidate
         -> try normal core stamp
         -> try mirrored core stamp
         -> reject invalid stamps
    -> choose best controller/core pair by
         1. upgrade-capacity tier
         2. first-spawn range to selected center
    -> choose source/mineral containers
    -> recompute final Dijkstra map with containers blocked
    -> build per-resource shortest-path DAGs
    -> merge them with bitmask DP
```

`planBase()` currently calls `planResourceTree()` after the core is chosen. Dynamic lab placement is the next unimplemented planning stage.

## Controller area

### Storage is the controller-side anchor

Storage is placed at controller range 4 and becomes the permanent anchor for the upgrade area and local core.

This keeps the prime controller-facing position useful from RCL4 rather than reserving it for the RCL6 terminal.

### Storage candidates must have three roots

A storage candidate is accepted only when it has three adjacent tiles that are:

- in the selected regions; and
- inside controller range 3.

These three tiles become `left`, `middle`, and `right` upgrade roots.

Requiring three roots gives the core a stable middle root and therefore a well-defined forward direction.

### Upgrade chains

Each root may grow into an upgrade chain of length at most 6.

The current chain search:

- follows the outer left and right chains along the upgrade-area boundary;
- searches combinations of outer-chain lengths to make room for a middle path;
- attempts to reach 18 total upgrader tiles;
- extends shorter outer chains when useful after the middle path is found;
- retries completed outer chains with the opposite wall-following hand to compact them when chain length is not reduced.

Controller-area quality is classified by total upgrade-chain tiles:

- tier 1: at least 16 tiles;
- tier 2: 13-15 tiles;
- tier 3: 12 or fewer tiles.

Tier is the primary preference for final controller-area/core selection.

## Core stamp

The canonical local-coordinate stamp is currently:

```ts
export const CORE_STAMP = {
  storage: { x: 0, y: 0 },
  terminal: { x: 1, y: 1 },
  manager: { x: 1, y: 0 },
  spawn: { x: 2, y: 1 },
  link: { x: 2, y: -1 },
  linkFallback: { x: 2, y: 0 },
  roads: [
    { x: -1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
  ],
}
```

Storage is the local origin. The forward direction is always:

```text
storage -> middleRoot
```

The planner tries the same oriented stamp in normal and mirrored form. The link is the only current flexible stamp element: the primary position is `(2, -1)` and the fallback is `(2, 0)`.

A core coordinate is invalid when it is outside the room, outside the selected regions, or overlaps an upgrade-chain tile.

## Final core selection

All valid core plans from all controller-area candidates compete globally.

The preference is lexicographic:

1. lower upgrade-capacity tier number;
2. smaller Screeps range from `firstSpawn` to `selectedCenter`;
3. stable iteration order for remaining ties.

No extra score is currently applied for storage openness, distance transform, link position, terminal position, symmetry, or visual appearance.

## Implemented resource tree

### Dijkstra roots and costs

All `corePlan.roads` are passed to `dijkstraMap()` as start coordinates.

The current permanent-road cost is:

```text
plain = 5
swamp = 6
```

`dijkstraMap.ts` itself is unchanged by the resource-container logic.

### Blocked geometry

Before resource planning, the planner blocks:

- storage;
- all upgrade-chain tiles;
- first spawn;
- terminal;
- core link;
- manager tile;
- source tiles themselves;
- mineral tiles themselves.

Core road tiles remain Dijkstra roots and are not eligible resource-container positions.

### Container selection

Resource containers are selected before the final DAG/DP merge.

The procedure is iterative:

```text
while an unassigned resource remains:
    run Dijkstra with already selected containers blocked

    choose the currently nearest unassigned resource

    build shortest-path DAG masks for the other remaining resources

    inspect every reachable range-1 container candidate

    prefer a candidate that is not inside any other target DAG
        -> among those, choose minimum Dijkstra distance

    if every candidate overlaps another target DAG
        -> choose the minimum-distance candidate anyway

    reserve that tile as the resource container
    mark it blocked
    repeat
```

This gives inner/near resources first choice of a container while trying not to consume tiles that current shortest paths to farther resources depend on.

The planner intentionally recomputes Dijkstra after every selected container. There are only the room's source/mineral targets, so the simpler recomputation is preferred over maintaining an incremental distance map.

### Containers are blocked, not terminal Dijkstra nodes

A selected container is simply added to `blockedMap`.

The generic Dijkstra implementation does not need a special `canExpand` or terminal-node concept.

After all containers are selected, the final road target for each resource becomes the set of minimum-distance reachable tiles adjacent to its blocked container:

```text
resource
   C     <- blocked container
   R     <- final road endpoint candidate
   R
   R
core road frontier
```

The container itself is not a road.

### Final shortest-path DAGs

With all containers blocked, the planner runs Dijkstra again and builds one shortest-path DAG mask per resource from the minimum-distance tiles adjacent to that resource's container back toward the core road frontier.

These DAGs are combined into the existing per-tile resource bitmask search space.

### Merged-tree selection

A bitmask DP selects the minimum number of unique non-root road tiles inside the combined shortest-path DAGs.

The old implementation treated every resource endpoint tile as a dedicated terminal tile that unrelated paths could not traverse. That restriction has been removed.

The actual reserved endpoint is now the blocked container, so a road tile adjacent to a container may still be shared by or traversed by another resource branch. A DP state may terminate one resource at that road tile while another resource continues through it.

This permits natural shared trunks and shared endpoint-road geometry without allowing any path to pass through the container itself.

### Return value

The resource tree now exposes both the unique road union and target-specific branches:

```ts
export interface ResourceBranchPlan {
  readonly targetId: Id<Source> | Id<Mineral>
  readonly container: RoomCoordinate
  readonly roads: RoomCoordinate[]
}

export interface ResourceTreePlan {
  readonly roads: RoomCoordinate[]
  readonly branches: ResourceBranchPlan[]
}
```

`ResourceTreePlan.roads` contains each added resource-tree road tile once. Core root roads are not duplicated there.

Each branch contains:

- the source/mineral ID;
- its selected container coordinate;
- the ordered road path chosen by the final merged DP from the core frontier toward that container.

Shared trunk roads intentionally appear in more than one branch's `roads` array. This makes later code able to ask either for the whole resource road network or for the route associated with one resource.

The current planner visualization draws the unique road union as roads and draws each selected final resource tile as a container.

Downstream planners that need the full walkable road network should combine:

```text
corePlan.roads + resourceTree.roads
```

Resource containers are reserved structures, not service-road tiles.

## Region policy

The planner currently does not modify terrain-region generation to rescue controller areas assigned to the outside region.

Some unusual rooms may therefore be unsupported even when a hand-designed base could fit there. This remains intentional for now.

## Upgrade-chain lifecycle

The long-term direction remains:

- RCL1-6: preserve all generated upgrade-chain tiles;
- RCL7: two chains are sufficient, so one chain may eventually be reclaimed for late structures;
- RCL8: one final upgrader chain is sufficient for the controller's 15 energy/tick cap, so other chain tiles may eventually be reclaimed.

The exact per-tile RCL availability representation is not yet implemented.

## Consequences

- Controller quality is preserved before core compactness is considered.
- The core has deterministic structure and predictable manager logistics.
- Core roads and structures never consume planned upgrader tiles.
- The resource tree uses a multi-tile core frontier rather than an artificial single `A` tile.
- Resource containers cannot be used as transit tiles by another resource path.
- Resource endpoint roads remain shareable because only the container itself is reserved.
- Target-specific ordered branches are preserved for later source/mineral logic and visualization.
- Downstream lab planning can reuse `corePlan.roads + resourceTree.roads` while reserving the returned containers.

## Next step: dynamic labs

The next unimplemented planner stage is dynamic lab placement, documented in `0003-dynamic-lab-placement.md`.

It should consume the current core/resource geometry and produce a reaction-valid 2-input / 8-output lab layout plus any short additional lab-service roads required.

## Open questions

The following are intentionally left for later stages:

- dynamic lab placement on the current core/resource geometry;
- the exact extension-growth root/metric now that the old explicit `A` tile is gone;
- expected rampart boundary and internal access lanes;
- final RCL ordering and reclamation of upgrade tiles;
- later spawns, factory, power spawn, towers, and other late structures;
- final min-cut/rampart integration.
