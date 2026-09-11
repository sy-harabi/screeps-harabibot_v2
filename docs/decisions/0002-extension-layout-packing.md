# Extension layout packing

Status: proposed
Date: 2026-09-11

## Context

The core-layout decision in `0001-base-planner-core-layout.md` establishes the controller area, core, resource roads, and dynamic labs. Extension placement should build on that geometry rather than introduce a separate stamp or an unrelated road system.

The main goals are:

- keep extensions spatially compact around the logistics root `A`;
- reuse source, mineral, core, lab, and future rampart-access roads whenever useful;
- reserve defender/repairer access to the expected defensive perimeter before filling the interior with extensions;
- add as little extension-specific road as possible;
- allow irregular terrain to deform the layout naturally;
- avoid encoding observed good spacing as a large collection of special-case heuristics.

The design should optimize the gameplay property directly: fit all 60 extensions into the smallest useful area around `A`, using as few new road tiles as possible inside that area.

## Terminology

- **expected rampart boundary**: an early approximation of the future defensive perimeter derived from the selected base region. This is planning geometry, not necessarily the final min-cut result.
- **rampart segment**: one contiguous portion of the expected rampart boundary, separated from other portions by walls or disconnected terrain.
- **segment lane**: an internal road connection from the existing road network to one rampart segment so defenders and repairers can reach it.
- **mandatory roads**: roads already justified by another subsystem, including core access roads, resource lanes, lab service roads, and rampart segment lanes.
- **growth radius**: Screeps range from `A`. A candidate extension layout only uses service roads and extension slots inside the current radius.
- **service road**: any road tile whose adjacent buildable tiles may serve as extension positions.
- **extension branch**: extension-specific road geometry added only when mandatory roads do not provide enough extension capacity.
- **extension capacity**: the number of unique valid extension tiles adjacent to the service-road set.

## Decision

### 1. Estimate the defensive perimeter before extension placement

After selected regions and the core/resource/lab geometry are known, derive an expected rampart boundary from the selected base area.

The purpose is not to finalize defense before the rest of the planner exists. The purpose is to reserve the movement skeleton that future defense will need so extension placement does not block it.

Split the expected boundary into contiguous rampart segments.

For each segment, connect the existing internal road network to the segment with an internal lane. New segment lanes may reuse roads created for previous segments. Independent lanes should not be generated and unioned afterward if an equally short merged connection is available.

The resulting road skeleton is conceptually:

```text
A / core
   |
   +-- source 1
   +-- source 2
   +-- mineral
   +-- rampart segment 1
   +-- rampart segment 2
   +-- rampart segment 3
```

The final rampart/min-cut algorithm may later replace the expected boundary, but extension placement should already respect perimeter-access lanes.

### 2. Extension growth is rooted at A

Extensions are not filled around every road in the room at once.

`A` is the root of the extension-growth area. The planner examines increasingly large Screeps-range boxes around `A`:

```text
radius r
    -> consider only service roads inside range r of A
    -> calculate extension capacity inside range r
    -> add extension-specific branches only if necessary
    -> stop at the first radius that can support 60 extensions
```

A mandatory road may extend far beyond the current growth radius toward a source or rampart. Its distant part does not cause distant extensions to be selected early. Only the portion reached by the current growth radius participates in packing.

This preserves the desired "plant growth" behavior: leaves appear near the root first, even when long mandatory trunks already exist.

### 3. Reuse mandatory roads as free extension service roads

Inside the current growth radius, all suitable mandatory roads may serve extensions.

This includes:

- core access roads;
- resource roads;
- rampart segment lanes;
- lab service roads when their geometry permits it.

Extension placement does not need a separate road network when existing roads already expose useful buildable tiles.

Extension capacity is always calculated using unique tiles. If multiple roads can service the same extension tile, that tile counts once.

### 4. Add short diagonal branches only when necessary

If mandatory roads inside the current growth radius cannot support 60 extensions, generate extension-specific branch candidates.

The default branch primitive is a three-tile diagonal road segment:

```text
R
 \
  R
   \
    R
```

All four diagonal directions are allowed. Branches may grow on either side of existing roads.

The three-tile diagonal shape is not justified by a fixed stamp. Empirically it exposes a large number of extension-adjacent tiles for a small road cost, commonly on the order of 15-17 useful extension positions in open geometry before overlaps and reservations are considered.

A branch may overlap or reuse existing road tiles when geometry permits. Its cost is therefore the number of **unique new road tiles**, not `3 * branchCount`.

Loops are allowed. The planner should not reject a compact branch merely because it touches multiple existing roads or closes a road loop. Such loops may also improve filler and defender mobility.

### 5. Do not encode 2.5-tile branch spacing as a hard rule

Open-terrain experiments showed that parallel diagonal branches often pack extensions efficiently when their effective perpendicular spacing is roughly 2.5 tiles. Terrain or reserved structures may naturally push a useful branch closer to about 3 tiles.

This is an observation, not a planner constraint.

The planner should not contain a rule such as:

```text
nextBranchSpacing = 2.5
```

or a transformed-coordinate equivalent.

Instead, evaluate the actual extension capacity created by candidate road combinations. Branches that are too close waste capacity through overlapping extension neighborhoods. Branches that are too far apart require a larger growth radius. Compact packing should therefore emerge from the optimization objective itself.

### 6. Select layouts lexicographically by compactness and road cost

The extension layout objective is intentionally small and explicit.

Primary objective:

```text
minimize growth radius from A that can support at least 60 extensions
```

Secondary objective within the same radius:

```text
minimize the number of unique extension-specific road tiles
```

Remaining ties should preserve stable deterministic iteration order unless later evidence justifies another explicit rule.

Do not add weighted terms for branch spacing, branch direction, distance transform, average extension distance, branch count, or visual symmetry unless a separate design decision establishes a gameplay reason for them.

This means a candidate at radius 7 with 12 new road tiles beats a candidate at radius 8 with 5 new road tiles. Compact area is the primary goal; road economy is secondary within that compact area.

### 7. Capacity is measured from the final service-road set

For each candidate road combination:

```text
serviceRoads = mandatoryRoadsInsideRadius
             + uniqueExtensionBranchRoads

extensionSlots = unique valid buildable tiles
                 adjacent to serviceRoads
                 inside the current growth area
                 excluding reserved tiles
```

A candidate succeeds when:

```text
extensionSlots >= 60
```

The planner should calculate this directly. It should not estimate one branch as a fixed number of extensions because overlap with other roads, terrain, labs, upgrade chains, and ramparts changes the actual capacity.

If a candidate exposes more than 60 extension slots, the final 60 may be chosen in A-near order for construction/RCL sequencing. Packing feasibility itself depends only on having at least 60 valid slots.

## Intended planning pipeline

The current design direction is:

```text
terrain regions
    -> selected regions
    -> controller area / upgrade chains
    -> core around storage and manager
    -> A logistics root
    -> merged resource roads
    -> dynamic labs near A
    -> expected rampart boundary
    -> rampart segments
    -> merged segment-access lanes
    -> compact extension packing around A
         -> mandatory roads inside radius
         -> optional 3-tile diagonal branches
         -> 60 extension leaves
```

Extension packing therefore happens after the main movement skeleton is known. Extensions are leaves attached to that skeleton, not structures that determine the skeleton afterward.

## Prototype evidence

The compact-packing prototype was tested on saved `shardSeason` room layouts produced by the earlier core/resource/lab experiments.

Representative successful results included:

- `W21N52`: minimum radius 8, 8 unique new road tiles, 3 diagonal branch templates;
- `E3N36`: minimum radius 6, 10 unique new road tiles, 4 branch templates;
- `E29N53`: minimum radius 8, 13 unique new road tiles, 6 branch templates;
- `E24N19`: minimum radius 7, 7 unique new road tiles, 3 branch templates.

Some branch templates reused existing roads or overlapped one another, so branch count and road cost were intentionally different quantities.

The prototype also found rooms where 60 extensions could not fit under the current selected-area and reserved-geometry assumptions. Those failures should not be hidden by allowing extensions to spill arbitrarily outside the selected region. They are evidence that selected-region size/connectivity and final defensive geometry must be validated as part of the full planner.

These numbers are experimental evidence only. They are not fixed thresholds for production selection.

## Reasons

This approach keeps extension planning aligned with the rest of the V2 planner:

- the controller/core design establishes `A` as the logistics root;
- resource and rampart roads create useful mandatory trunks;
- labs reuse and locally extend those trunks;
- extensions then occupy the remaining interior efficiently instead of forcing a separate global road pattern.

The lexicographic objective also captures the observed good branch spacing without explicitly encoding it. Tight branches overlap too much and gain little capacity; overly separated branches force a larger radius. Efficient spacing emerges because the planner is solving the actual packing problem.

The model remains flexible in irregular terrain. A wall, lab cluster, rampart lane, or other reserved structure may deform branch placement without requiring a special exception for a preferred geometric pattern.

## Consequences

- Extension search is more expensive than applying a fixed stamp, but base planning is not a per-tick hot path and the search space can be bounded by growth radius and compact branch primitives.
- Mandatory roads must remain available as explicit path/tile sets so extension packing can reuse them.
- Expected rampart geometry must be available before final extension placement.
- The planner needs a deterministic method to enumerate compact three-tile diagonal branch candidates and combinations.
- Search implementation should prune combinations that cannot beat the current best unique-road count or cannot reach 60 extension capacity.
- Final extension RCL assignment can naturally follow A-near growth order once the 60 positions are selected.
- Rooms whose selected region is too small or disconnected must fail clearly and trigger an earlier planner fallback rather than silently violating the intended defensive area.

## Alternatives considered

### Fill every existing road first

Rejected. A long source or rampart road would cause distant extensions to appear simply because the road already exists. Extension growth should remain rooted near `A`.

### One branch per road depth

Tested as an early-growth throttle. It created an arbitrary relationship between road graph depth and extension geometry and could either create too many branches or still produce poor packing. The compact-packing objective makes this rule unnecessary.

### Add one road tile only when immediate leaf capacity increases

Tested as a local greedy growth rule. It generated many small branches and made the layout depend heavily on local iteration order. Three-tile diagonal branch primitives produce a cleaner search space and better reflect observed efficient extension geometry.

### Hard 2.5-tile branch spacing

Rejected. Roughly 2.5-tile perpendicular spacing is often efficient in open terrain, but terrain and reserved structures can make approximately 3 tiles better. Actual extension capacity and minimum growth radius already express the reason that spacing works.

### Require extension branches to remain a tree

Rejected. Preventing a branch from touching multiple roads unnecessarily excludes compact geometry and useful mobility loops.

### Ignore mandatory roads when generating extensions

Rejected. Resource, rampart, core, and lab roads are already paid for and should contribute extension service capacity when they pass through the active growth area.

## Open questions

The following are not settled by this record:

- the final algorithm for deriving the expected rampart boundary and how it transitions to the real min-cut/rampart planner;
- how many access points a very long rampart segment should receive;
- the exact production search/pruning strategy for branch combinations;
- whether the default three-tile diagonal primitive needs a fallback shape in unusually constrained terrain;
- how selected-region expansion should react when 60 extensions cannot fit inside the current defensive area;
- how disconnected selected regions should be rejected or repaired earlier in the pipeline;
- final RCL ordering of the chosen 60 extensions;
- whether later mobility analysis should add roads after extension packing.

These should be resolved from planner output and measured gameplay behavior rather than by adding speculative weights to the packing objective.
