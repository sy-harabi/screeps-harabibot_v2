# Extension layout packing

Status: proposed; not yet implemented
Date: 2026-09-11
Updated: 2026-09-12

## Context

Extension placement should build on the geometry already established by the controller area, core, resource tree, dynamic labs, and later rampart-access planning rather than introduce a separate large stamp or unrelated road system.

The current code no longer contains the old explicit logistics tile `A`. The implemented core exposes `corePlan.roads` as a multi-tile frontier, and `planResourceTree()` grows the merged resource network from that frontier.

The current resource planner also returns explicit per-target branch metadata:

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

`resourceTree.roads` is road geometry that later planners may reuse. `resourceTree.branches[].container` is occupied structure geometry and must remain reserved.

Therefore references in the earlier prototype to "distance/radius from A" must not be treated as current implementation truth.

The main extension goals remain:

- keep extensions spatially compact around the useful core area;
- reuse core, resource, lab, and future rampart-access roads whenever useful;
- reserve resource containers and other fixed structures before packing extensions;
- reserve defender/repairer access to the expected defensive perimeter before filling the interior;
- add as little extension-specific road as possible;
- allow irregular terrain to deform the layout naturally;
- avoid encoding observed good spacing as a large collection of special-case heuristics.

## Current implementation boundary

Extension packing is not yet implemented.

The current implemented planner reaches:

```text
selected regions
    -> controller area / upgrade chains
    -> core
    -> merged resource tree + per-target containers
```

Dynamic labs are the next planned stage. Expected rampart access and extension packing remain downstream design work.

## Terminology

- **core road frontier**: `corePlan.roads`, the current multi-tile road root used by the resource planner.
- **resource roads**: `resourceTree.roads`, the unique union of resource-road tiles available for downstream reuse.
- **resource container**: `resourceTree.branches[].container`, an occupied structure tile adjacent to one source/mineral. It is not a road/service tile.
- **growth root / growth metric**: the yet-to-be-finalized reference used to define how spatially close an extension layout is to the core. The old prototype used a single tile `A`; the current implementation does not have one.
- **expected rampart boundary**: an early approximation of the future defensive perimeter derived from the selected base region. This is planning geometry, not necessarily the final min-cut result.
- **rampart segment**: one contiguous portion of the expected rampart boundary, separated from other portions by walls or disconnected terrain.
- **segment lane**: an internal road connection from the existing road network to one rampart segment so defenders and repairers can reach it.
- **mandatory roads**: roads already justified by another subsystem, including core roads, resource roads, lab service roads, and rampart segment lanes.
- **reserved structures**: already committed non-road tiles including core structures, resource containers, labs, controller/resource objects, and other fixed planner geometry.
- **service road**: any road tile whose adjacent buildable tiles may serve as extension positions.
- **extension branch**: extension-specific road geometry added only when mandatory roads do not provide enough extension capacity.
- **extension capacity**: the number of unique valid extension tiles adjacent to the service-road set.

## Decision

### 1. Estimate defensive access before final extension packing

After selected regions and core/resource/lab geometry are known, derive an expected rampart boundary from the selected base area.

The purpose is not to finalize defense before the rest of the planner exists. The purpose is to reserve the movement skeleton that future defense will need so extension placement does not block it.

Split the expected boundary into contiguous rampart segments.

For each segment, connect the existing internal road network to the segment with an internal lane. New segment lanes may reuse roads created for previous segments. Independent lanes should not simply be generated and unioned afterward if an equally short merged connection is available.

Conceptually, the mandatory movement skeleton is:

```text
core road frontier
   +-- source 1 branch -> container
   +-- source 2 branch -> container
   +-- mineral branch  -> container
   +-- lab service branch(es)
   +-- rampart segment 1
   +-- rampart segment 2
   +-- rampart segment 3
```

The branch roads are part of the reusable movement skeleton. The containers at their ends are not: they remain occupied reserved tiles.

The final rampart/min-cut algorithm may later replace the expected boundary, but extension placement should already respect perimeter-access lanes.

### 2. Compact growth remains the primary objective, but the exact root is unresolved

The earlier prototype expanded Screeps-range boxes around a single `A` tile.

That exact rule is no longer valid because current V2 has no explicit `A`.

Before production extension implementation, choose an explicit current-core growth metric. Plausible options include:

- range from a stable core structure such as storage;
- minimum range from the core road frontier;
- graph/service distance from the core road frontier;
- another simple core-derived metric justified by actual planner output.

This decision should be made separately rather than silently reintroducing `A`.

Regardless of the exact metric, the intended behavior remains:

```text
small growth extent
    -> use mandatory roads in that extent
    -> calculate extension capacity
    -> add extension-specific branches only if necessary
    -> expand the extent only when 60 extensions cannot fit
```

A mandatory road may extend far toward a source or rampart. Its distant part should not cause distant extensions to be selected early merely because the road already exists.

### 3. Reuse mandatory roads as free extension service roads

Inside the active growth area, all suitable mandatory roads may serve extensions.

This includes:

- `corePlan.roads`;
- `resourceTree.roads`;
- rampart segment lanes;
- lab service roads when their geometry permits it.

Extension placement does not need a separate road network when existing roads already expose useful buildable tiles.

`resourceTree.branches` does not add extra road tiles beyond `resourceTree.roads`; it only preserves target-specific path identity and resource-container positions. The container positions are reserved structures, not service roads.

Extension capacity is always calculated using unique tiles. If multiple roads can service the same extension tile, that tile counts once.

### 4. Reserve occupied structures before extension capacity is measured

Before counting extension slots or generating extension-specific branches, reserve all fixed occupied/protected geometry.

At minimum this includes:

- storage, terminal, spawn, link, manager reservation, and other fixed core geometry;
- controller and resource objects;
- all `resourceTree.branches[].container` tiles;
- planned labs;
- upgrade-chain tiles that remain reserved at the relevant stage;
- rampart/perimeter geometry that must not be consumed;
- any other committed planner structure tile.

A resource container must never become an extension tile or an extension-specific road tile.

The final road tile immediately before a container remains ordinary road geometry and may still service nearby extensions if it lies inside the active growth area.

### 5. Add short diagonal branches only when necessary

If mandatory roads inside the current growth area cannot support 60 extensions, generate extension-specific branch candidates.

The default prototype branch primitive is a three-tile diagonal road segment:

```text
R
 \
  R
   \
    R
```

All four diagonal directions are allowed. Branches may grow on either side of existing roads.

The three-tile diagonal shape is not a fixed stamp. Prototype experiments found that it often exposes many extension-adjacent tiles for a small road cost.

A branch may overlap or reuse existing road tiles when geometry permits. Its cost is therefore the number of **unique new road tiles**, not `3 * branchCount`.

Loops are allowed. The planner should not reject compact geometry merely because a branch touches multiple existing roads or closes a road loop.

### 6. Do not encode 2.5-tile branch spacing as a hard rule

Open-terrain experiments showed that parallel diagonal branches often pack extensions efficiently when their effective perpendicular spacing is roughly 2.5 tiles. Terrain or reserved structures may naturally push a useful branch closer to about 3 tiles.

This is an observation, not a planner constraint.

The planner should not contain a rule such as:

```text
nextBranchSpacing = 2.5
```

Instead, evaluate the actual extension capacity created by candidate road combinations.

Branches that are too close waste capacity through overlapping extension neighborhoods. Branches that are too far apart require a larger growth extent. Efficient spacing should emerge from the actual compactness/capacity objective.

### 7. Select layouts lexicographically by compactness and new-road cost

Once the current-core growth metric is fixed, the objective should remain intentionally small and explicit.

Primary objective:

```text
minimize the growth extent needed to support at least 60 extensions
```

Secondary objective within the same growth extent:

```text
minimize the number of unique extension-specific road tiles
```

Remaining ties preserve stable deterministic iteration order unless later evidence justifies another explicit rule.

Do not add weighted terms for branch spacing, branch direction, distance transform, average extension distance, branch count, or visual symmetry without a gameplay reason.

### 8. Capacity is measured from the final service-road set

For each candidate road combination:

```text
serviceRoads = mandatoryRoadsInsideGrowthArea
             + uniqueExtensionBranchRoads

extensionSlots = unique valid buildable tiles
                 adjacent to serviceRoads
                 inside the current growth area
                 excluding reserved structures
```

Reserved structures explicitly include resource containers.

A candidate succeeds when:

```text
extensionSlots >= 60
```

The planner should calculate this directly. It should not estimate one branch as a fixed number of extensions because overlap with terrain, labs, upgrade chains, resource containers, roads, and ramparts changes the actual capacity.

If a candidate exposes more than 60 extension slots, the final 60 may later be ordered by the chosen core-growth metric for construction/RCL sequencing. Packing feasibility itself depends only on having at least 60 valid slots.

## Intended planning pipeline

The current implementation/design sequence is:

```text
terrain regions                         implemented
    -> selected regions                 implemented
    -> controller area / upgrade chains implemented
    -> core                             implemented
    -> merged resource tree + containers implemented
    -> dynamic labs                      proposed next stage
    -> expected rampart boundary         proposed
    -> rampart segments/access lanes     proposed
    -> compact extension packing         proposed
         -> mandatory roads in growth area
         -> reserve fixed structures/containers
         -> optional diagonal branches
         -> 60 extension leaves
```

Extension packing therefore happens after the main movement skeleton is known. Extensions are leaves attached to that skeleton, not structures that determine the skeleton afterward.

## Prototype evidence

The compact-packing prototype was tested on saved `shardSeason` room layouts produced by an earlier planner version that still used a single `A` growth root.

Representative prototype results included:

- `W21N52`: minimum radius 8, 8 unique new road tiles, 3 diagonal branch templates;
- `E3N36`: minimum radius 6, 10 unique new road tiles, 4 branch templates;
- `E29N53`: minimum radius 8, 13 unique new road tiles, 6 branch templates;
- `E24N19`: minimum radius 7, 7 unique new road tiles, 3 diagonal branch templates.

Some branch templates reused existing roads or overlapped one another, so branch count and road cost were intentionally different quantities.

These numbers remain useful prototype evidence for branch-packing behavior, but their reported `radius from A` is **not directly the current V2 metric** and must be remeasured after the growth root/metric is finalized.

The prototype also found rooms where 60 extensions could not fit under the selected-area and reserved-geometry assumptions. Those failures should not be hidden by allowing extensions to spill arbitrarily outside the selected region.

## Reasons

This approach keeps extension planning aligned with the current V2 planner:

- the core exposes a small deterministic local geometry and a multi-tile road frontier;
- the resource tree creates reusable mandatory trunks and explicit resource containers;
- labs reuse and locally extend those trunks while respecting the containers;
- rampart access adds defense-required lanes;
- extensions then occupy the remaining interior efficiently instead of forcing a separate global road pattern.

The lexicographic objective should capture useful branch spacing without explicitly encoding it. Tight branches overlap too much and gain little capacity; overly separated branches require a larger growth extent.

The model remains flexible in irregular terrain. A wall, lab cluster, resource container, rampart lane, or other reserved structure may deform branch placement without requiring a special exception for a preferred geometric pattern.

## Consequences

- Extension search is more expensive than applying a fixed stamp, but base planning is not a per-tick hot path and the search space can be bounded.
- Mandatory roads must remain available as explicit path/tile sets so extension packing can reuse them.
- Resource containers remain explicit reserved structure tiles and are never counted as service roads.
- `resourceTree.branches` remains useful for target-specific visualization/debugging even though capacity uses the unique road union.
- Expected rampart geometry should be available before final extension placement.
- The planner needs a deterministic method to enumerate compact diagonal branch candidates and combinations.
- Final extension RCL assignment can follow a core-near ordering once the growth metric is defined.
- Rooms whose selected region is too small or disconnected should fail clearly or trigger an earlier planner fallback rather than silently violating the intended defensive area.
- The old explicit `A` abstraction must not be reintroduced accidentally through documentation or code comments.

## Alternatives considered

### Keep using the old A-based radius unchanged

Rejected as documentation of current V2. The implemented core no longer exposes `A`.

### Treat resource containers as resource roads

Rejected. The resource planner deliberately separates the final container structure tile from `resourceTree.roads`.

### Fill every existing road first

Rejected. A long source or rampart road would cause distant extensions to appear simply because the road already exists. Extension growth should remain core-local first.

### One branch per road depth

Tested as an early-growth throttle. It created an arbitrary relationship between road graph depth and extension geometry and could either create too many branches or still produce poor packing.

### Add one road tile only when immediate leaf capacity increases

Tested as a local greedy growth rule. It generated many small branches and made the layout depend heavily on local iteration order. Three-tile diagonal branch primitives produced a cleaner prototype search space.

### Hard 2.5-tile branch spacing

Rejected. Roughly 2.5-tile perpendicular spacing is often efficient in open terrain, but terrain and reserved structures can make approximately 3 tiles better. Actual capacity and compactness should express the reason that spacing works.

### Require extension branches to remain a tree

Rejected. Preventing a branch from touching multiple roads unnecessarily excludes compact geometry and useful mobility loops.

### Ignore mandatory roads when generating extensions

Rejected. Core, resource, rampart, and lab roads are already paid for and should contribute extension service capacity when they pass through the active growth area.

## Open questions

The following are not settled by this record:

- the exact extension growth root/metric for the current no-`A` core;
- the final algorithm for deriving the expected rampart boundary and how it transitions to the real min-cut/rampart planner;
- how many access points a very long rampart segment should receive;
- the exact production search/pruning strategy for branch combinations;
- whether the default three-tile diagonal primitive needs a fallback shape in unusually constrained terrain;
- how selected-region expansion should react when 60 extensions cannot fit inside the current defensive area;
- how disconnected selected regions should be rejected or repaired earlier in the pipeline;
- final RCL ordering of the chosen 60 extensions;
- whether later mobility analysis should add roads after extension packing.

These should be resolved from current V2 planner output and measured behavior rather than by adding speculative weights.
