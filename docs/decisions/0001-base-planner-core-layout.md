# Base planner core layout

Status: proposed
Date: 2026-09-10

## Context

The V2 base planner is being designed before source management because the layout determines several long-lived economy and logistics constraints.

The main goals are:

- keep the base compact enough to defend efficiently;
- make extension and general refill paths short and simple;
- avoid the controller-energy throughput problems of the old central-hub design;
- keep the terminal and storage usable by ordinary haulers instead of making them effectively manager-only;
- make the controller-side storage useful as soon as RCL4 rather than reserving the prime controller position for the RCL6 terminal;
- reuse required logistics roads as the backbone for later layout generation;
- prefer simple structural rules over a large weighted scoring function.

The planner should distinguish three kinds of rules:

1. hard constraints that make a candidate valid or invalid;
2. explicit lexicographic preferences that have been intentionally chosen;
3. raw metrics used for inspection and later decisions.

Do not introduce additional weighted heuristics without a separate design decision.

## Terminology

- **selected regions**: terrain regions chosen as the initial base area.
- **selected center**: center of mass of all tiles in the selected regions. Average `x` and `y` independently, then round both coordinates with `Math.round`.
- **Screeps range**: Chebyshev distance, equivalent to `getRange`.
- **S**: storage and controller-area anchor.
- **T**: terminal.
- **M**: stationary manager tile.
- **L**: manager-serviced storage/core link.
- **P1**: first spawn.
- **A**: logistics root/access tile used as the main starting point for external hauling roads.
- **upgrade area**: selected-region tiles within controller range 3.
- **upgrade chains**: walkable upgrader positions generated from roots adjacent to the storage.
- **core access roads**: walkable tiles other than occupied core tiles that are adjacent to both `T` and `S`.
- **resource lane/tree**: roads from `A` to source and mineral work tiles.
- **lab service branch**: additional walkable service tiles branching from the resource lane when the lane alone cannot support a good dynamic lab cluster near `A`.

## Current implementation

`planControllerArea.ts` implements the controller-side storage and upgrade-chain generation:

- storage candidates are on controller range 4 and inside selected regions;
- candidate generation keeps candidates with the maximum number of adjacent upgrade-area tiles;
- roots adjacent to the storage are ordered as left, middle, and right relative to the controller-storage direction;
- each chain has a maximum length of 6;
- the planner searches combinations of left/right lengths and a middle path to reach up to 18 total upgrader tiles;
- shorter outer chains may be extended after the middle path is chosen;
- completed outer chains are compacted by retrying them with the opposite wall-following hand, but only when the compact path does not reduce chain length;
- storage candidates are ranked by upgrade-capacity tier and then by Screeps range to the rounded selected center.

`planCore.ts` then generates the remaining local core around the selected storage:

- `M` is adjacent to `S` and at least one upgrade-chain root;
- `T`, `L`, and `P1` are generated on free tiles adjacent to `M`;
- after those occupied tiles are reserved, common `T/S` access roads are calculated;
- `A` is the common access-road tile closest to the selected center;
- cores are ranked by access-road tier and then by `A` distance to the selected center.

## Decision

### 1. Storage selection is based on upgrade capacity first

Storage, rather than terminal, is the controller-area anchor.

Storage becomes available at RCL4 while terminal becomes available at RCL6. The controller-facing high-value position should therefore become useful earlier and remain useful throughout the room lifecycle.

Generate the upgrade chains for each storage candidate before committing to a storage position.

Classify candidates by total usable upgrade-chain tiles:

- `>= 16`: top tier;
- `13..15`: middle tier;
- `<= 12`: bottom tier.

Choose the highest available tier.

Within the same tier, choose the storage with the smallest Screeps range to the rounded selected center.

Do not use Euclidean distance, distance transform, openness, or a weighted hub score as an additional tie-breaker. If candidates are still tied, preserve stable candidate order until there is a reason to introduce another rule.

### 2. The core is based on S, M, T, L, P1, and A

The desired topology is defined by relationships rather than a fixed stamp.

Required relationships include:

```text
range(M, S) = 1
range(M, T) = 1
range(M, L) = 1
range(M, P1) = 1
range(A, S) = 1
range(A, T) = 1
M != A
```

All occupied tiles must also satisfy the usual terrain, selected-region, reserved-tile, and structure-overlap constraints.

`M` must be adjacent to at least one upgrade-chain root. The storage is already the controller-area anchor, so `M` naturally sits between the controller-side upgrade geometry and the rest of the core.

The intended roles are:

- `S` is the early controller-side energy store and permanent core anchor;
- `M` handles stationary storage/terminal/link logistics;
- `T` is added around the manager later when it becomes available;
- `L` is reserved beside the manager for high-throughput link logistics;
- `P1` is reserved as part of the local core rather than being added afterward and accidentally consuming critical access geometry;
- `A` faces the base side and is the root of external logistics;
- `T` and `S` remain accessible to creeps other than the manager.

No additional score is currently applied to `T`, `L`, or `P1` beyond validity and their effect on the resulting access-road tier. Remaining ties preserve stable iteration order.

### 3. Prefer at least three common T/S access roads

For a valid core, find all buildable walkable tiles that are adjacent to both `T` and `S`, excluding occupied core tiles.

These tiles are reserved as core access roads. `A` is one of the common-access positions and acts as the primary logistics root.

Preference is tiered rather than weighted:

- first prefer cores with at least 3 common T/S access roads;
- if that is impossible, prefer 2;
- if that is impossible, allow 1;
- 4 roads are not inherently preferred over 3 roads.

Within the same access tier, prefer the candidate whose `A` has the smallest Screeps range to the rounded selected center.

Core access roads may lie inside controller range 3 when the tile is otherwise walkable and valid. The controller range restriction applies to occupied core structures, not automatically to roads.

The purpose of the additional roads is not to create several long hauling trunks immediately. They keep terminal/storage traffic from being manager-exclusive and provide multiple future connections to the base road network.

### 4. Resource roads start from A and form a merged shortest-path tree

After choosing the core, connect `A` to the source and mineral work tiles.

Each resource path should remain a shortest path from `A` to its work tile. Merging is optimized only among paths that preserve that shortest hauling distance.

The initial prototype exposed a bug where each target received an independent shortest path and the paths were merely unioned afterward. The corrected approach chooses among equivalent shortest paths so that new paths join the existing tree whenever possible.

With two sources and one mineral, all six resource-processing orders are cheap enough to test. Prefer the result with the fewest unique road tiles while preserving each target's shortest-path distance. Remaining ties use stable iteration order.

The resource tree becomes the shared backbone for later labs, extensions, and general room logistics.

### 5. Labs are dynamic and are generated around a service network

The old fixed lab stamp is discarded.

Labs should begin near `A` and the resource lane, but they do not have to remain directly adjacent to the resource lane. When needed, the planner may grow a short service branch from the lane.

The service network is:

```text
resource lane + optional lab service branch
```

Service-network tiles remain walkable and may not be occupied by labs.

For every candidate lab layout:

- choose two input labs;
- choose eight output labs;
- every output lab must be within range 2 of both input labs;
- all ten labs must be adjacent to at least one reachable service-network tile;
- connectivity from `A` through the service network must be checked explicitly so a lab can never block the only route to another lab.

Lab placement preference is lexicographic:

1. minimize the maximum service-network distance from `A` needed to reach a tile adjacent to any of the ten labs;
2. among equal results, minimize the number of added lab-branch tiles;
3. preserve stable iteration order for remaining ties.

This deliberately allows a short branch even when a zero-branch layout exists. A one-tile branch close to `A` is preferable to placing the whole lab cluster far down a resource road simply to avoid creating a branch.

The important abstraction is therefore not a lab stamp but a compact lab cluster serviced from the beginning of the room's existing logistics network.

## Candidate pipeline

The intended planning order is:

```text
terrain regions
    -> selected regions
    -> rounded selected center
    -> storage candidates at controller range 4
    -> upgrade chains for each storage candidate
    -> storage chain tier
    -> storage distance to selected center
    -> manager candidates
    -> terminal / link / first-spawn candidates around manager
    -> common T/S access-road tier
    -> A distance to selected center
    -> merged shortest-path resource tree
    -> dynamic labs near A with optional service branch
```

A downstream hard failure should reject that candidate and allow the planner to try the next candidate. It should not force invalid geometry merely because an earlier local candidate ranked first.

## Upgrade-chain lifecycle

The planner should keep early-RCL construction from destroying controller capacity.

Current design direction:

- RCL 1-6: preserve all generated upgrade chains;
- RCL 7: two chains are more than sufficient, so one chain may become available for late structures when three exist;
- RCL 8: one final upgrader chain is sufficient for the controller's 15 energy/tick cap; other chain tiles may be reclaimed;
- the final RCL8 upgrader root/path must remain accessible so the upgrader can be replaced.

This should eventually be represented as per-tile RCL availability rather than ad-hoc structure exceptions. The exact reclaim implementation is still open.

## Experimental evidence

The design was exercised against saved `shardSeason` room data rather than only hand-designed maps.

Notable observations from the experiments:

- evaluating upgrade-chain capacity before choosing the controller-area anchor found rooms where the first local candidate provided only 13 chain tiles while another provided 17;
- the `T/M/A/S` relationship topology was feasible in almost all sampled ordinary two-source rooms;
- in the 30-room access-road sample, 26 rooms supported at least 3 common T/S access roads, 3 supported only 2, and one narrow-wall case failed the hub topology entirely;
- forcing labs to use only the resource lane produced poor or unreachable layouts in some rooms;
- allowing short lab branches while prioritizing distance from `A` moved several lab clusters dramatically closer to the core;
- independent shortest-path generation created unnecessary parallel roads; choosing among equal shortest paths allowed substantial road merging in some rooms.

These results are evidence that the abstractions are viable, not permanent thresholds for future scoring.

## Reasons

This design keeps the planner relatively small while tying each local decision to a concrete gameplay role.

Storage gets the controller-facing anchor because it becomes available at RCL4, two controller levels before terminal, and remains central to energy flow for the lifetime of the room. The terminal can then occupy another manager-adjacent core tile when it becomes available at RCL6 without changing the upgrade geometry.

The manager is naturally controller-facing. The logistics root is naturally base-facing. Storage and terminal have multiple public access points. Required source/mineral roads become the base's main skeleton instead of being generated as an afterthought. Labs reuse that skeleton and only add local branches when necessary.

The design also avoids a monolithic score whose weights would be difficult to justify. When trade-offs appear, they remain visible as explicit ordered decisions instead of being hidden inside arbitrary coefficients.

## Consequences

- Storage selection is more expensive because upgrade chains must be generated for multiple candidates, but the candidate count is small and base planning is not a per-tick hot path.
- Storage becomes useful in its final controller-facing position from RCL4 onward; the terminal no longer reserves that prime position before it can be built.
- Core generation remains a small local brute-force search around the storage/manager pair.
- Link and first-spawn positions are part of candidate generation, so they cannot silently consume access-road tiles after the core is selected.
- The road planner must retain target paths, not only a set of road tiles, so merging and visualization are understandable.
- Lab generation becomes a search around a service network rather than stamp placement.
- Planner visualization should draw connected upgrade-chain paths, connected resource paths, shared road segments, core access roads, and lab branches rather than displaying only isolated tiles.
- Future extension generation should reuse the same road-tree concept where possible instead of creating an unrelated second transport network.

## Alternatives considered

### Weighted hub score

An experimental score mixed nearby free space, outward tiles, storage distance transform, and other terms. It was discarded because the coefficients did not have a defensible gameplay meaning and could silently override more important structural properties.

### Euclidean center distance

The selected-region center was initially considered as a floating-point coordinate with squared Euclidean distance. This was rejected. The center is rounded to an actual room coordinate and compared with normal Screeps range.

### Terminal as the controller-area anchor

The earlier design placed the terminal at controller range 4 and generated upgrade chains around it. This geometry works, but the terminal is unavailable until RCL6 while storage is available from RCL4. Giving the permanent controller-facing anchor to storage allows the core to use its final high-value position earlier without losing the same manager/access topology.

### Fixed lab stamp

A fixed lab pattern was rejected because it wastes space in irregular terrain and can force bad roads. Reaction geometry and service reachability are the real constraints.

### Labs restricted to the resource lane

This was too rigid. Labs may use a short service branch as long as the branch remains connected and walkable.

### Minimize lab branch length first

This caused zero-branch lab layouts far down resource roads to beat much closer layouts near `A`. Lab proximity to `A` is now the primary preference; branch length is secondary.

### Independent resource shortest paths followed by union

This produced parallel roads that failed to merge even when equivalent shortest paths could share tiles. Resource paths now preserve shortest distance while preferring a smaller merged tree.

## Open questions

The following are intentionally not settled by this record:

- whether terminal, link, or first-spawn placement needs an additional explicit preference after observing more rooms;
- whether common T/S access-road fallback needs stronger rules for unusual narrow rooms;
- extension-tree generation and filler behavior;
- exact RCL7/RCL8 upgrade-chain tile reclamation policy and data representation;
- placement of later spawns, factory, power spawn, towers, and other late structures;
- final defense/min-cut/rampart integration;
- how much room-level energy-flow and CPU telemetry should feed later planner decisions.

These should be decided from actual planner output and measured in-game behavior rather than by adding speculative scoring terms to the current core design.
