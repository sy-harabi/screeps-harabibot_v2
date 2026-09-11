# Base planner controller area and core layout

Status: implemented through core selection
Date: 2026-09-11

## Context

The V2 base planner establishes the controller area and the permanent local core before building the rest of the room road network.

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

## Current planning pipeline

The implemented pipeline through core selection is:

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
    -> choose best pair by
         1. upgrade-capacity tier
         2. first-spawn range to selected center
```

A downstream core failure rejects only that controller-area/core candidate. The planner may continue with another storage candidate or mirror.

## Controller area

### Storage is the controller-side anchor

Storage is placed at controller range 4 and becomes the permanent anchor for the upgrade area and local core.

This keeps the prime controller-facing position useful from RCL4, rather than reserving it for the RCL6 terminal.

### Storage candidates must have three roots

A storage candidate is accepted only when it has three adjacent tiles that are:

- in the selected regions; and
- inside controller range 3.

These three tiles become `left`, `middle`, and `right` upgrade roots.

The roots are found while evaluating the storage candidate and are carried directly into upgrade-chain generation. The planner does not count adjacent tiles first and rediscover the same roots later.

Requiring three roots also gives the core a stable middle root and therefore a well-defined forward direction.

### Upgrade chains

Each root may grow into an upgrade chain of length at most 6.

The current chain search:

- follows the outer left and right chains along the upgrade-area boundary;
- searches combinations of outer-chain lengths to make room for a middle path;
- attempts to reach 18 total upgrader tiles;
- extends shorter outer chains when useful after the middle path is found;
- retries completed outer chains with the opposite wall-following hand to compact them when chain length is not reduced.

All three chains are represented explicitly as:

```ts
interface UpgradeChains {
  left: RoomCoordinate[];
  middle: RoomCoordinate[];
  right: RoomCoordinate[];
}
```

### Upgrade-capacity tiers

Controller-area quality is classified by total upgrade-chain tiles:

- tier 1: at least 16 tiles;
- tier 2: 13-15 tiles;
- tier 3: 12 or fewer tiles.

Tier is the primary preference for final controller-area/core selection.

## Core stamp

### Small stamp, not a large bunker

After upgrade chains are known, the remaining tightly coupled local structures use a small fixed stamp.

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
};
```

Storage is the local origin and is already supplied by the controller-area candidate.

The previously tested protruding road at `(-2, 0)` was removed rather than given a road fallback. It did not justify making otherwise good rooms fail. The previous road at `(2, 0)` is also not part of the fixed road list because that tile is reserved as the link fallback.

### Orientation comes from the middle root

The stamp does not search arbitrary rotations.

Its forward direction is always:

```text
storage -> middleRoot
```

For valid controller-area candidates this direction is cardinal, so no 45-degree stamp rotation is required.

The canonical stamp is defined once. Room coordinates are produced from a local `forward` vector and its corresponding `right` vector. This avoids maintaining separate N/E/S/W stamp constants.

Because Screeps screen coordinates have increasing `y` downward, the transform is expressed in terms of `forward` and `right` rather than clockwise/counterclockwise terminology.

### Mirror search

For each controller-area candidate, the planner tries both reflections of the same oriented stamp:

```text
forward fixed by middle root
    -> mirrored = true
    -> mirrored = false
```

The stamp does not freely rotate after the controller area has been chosen. Controller geometry determines forward; mirror is the remaining local degree of freedom.

## Core construction and validity

`findCorePlans()` calls `tryCoreStamp()` for the two mirror states.

`tryCoreStamp()` constructs the core while validating it. Returning a `CorePlan` therefore means the stamp is valid; returning `undefined` means the candidate failed.

The order is intentionally simple:

```text
manager
    -> invalid: fail
terminal
    -> invalid: fail
first spawn
    -> invalid: fail
primary link
    -> invalid: try link fallback
    -> fallback invalid: fail
core roads
    -> any invalid: fail
return CorePlan
```

A coordinate is invalid when:

- it lies outside the room;
- it is outside the selected regions; or
- it overlaps an upgrade-chain tile.

Upgrade-chain tiles are reserved working positions. Core roads are not allowed to overlap them even though Screeps mechanically permits a creep to stand on a road. The planner wants those tiles to remain dedicated upgrader positions rather than become part of through traffic.

### Link fallback

The link is the only current flexible stamp element.

Primary position:

```text
(2, -1)
```

Fallback position:

```text
(2, 0)
```

The fallback is attempted only when the primary link coordinate is invalid. If the fallback is also invalid, the stamp fails.

There is currently no road fallback. The stamp road footprint was reduced instead of adding road-specific deformation rules.

## Final core selection

All valid core plans from all controller-area candidates compete globally.

The preference is lexicographic:

1. lower upgrade-capacity tier number;
2. smaller Screeps range from `firstSpawn` to `selectedCenter`;
3. stable iteration order for remaining ties.

In other words:

```text
controller upgrade quality
    > core facing the useful interior of the base
```

The first spawn is used as the base-facing representative point of the small core. No extra score is currently applied for storage openness, distance transform, link position, terminal position, symmetry, or visual appearance.

## Region policy

The planner currently does not modify terrain-region generation to rescue controller areas that are assigned to the outside region.

Some unusual rooms may therefore be unsupported even when a hand-designed base could fit there. This is intentional for now: the planner prefers a simple, reliable rule set over adding region exceptions for rare room geometry.

If real room samples later show that this rejects too many otherwise valuable rooms, the region policy can be revisited as a separate design decision.

## Upgrade-chain lifecycle

The long-term direction remains:

- RCL1-6: preserve all generated upgrade-chain tiles;
- RCL7: two chains are sufficient, so one chain may eventually be reclaimed for late structures;
- RCL8: one final upgrader chain is sufficient for the controller's 15 energy/tick cap, so other chain tiles may eventually be reclaimed.

The exact per-tile RCL availability representation is not yet implemented.

## Why this design

The current design deliberately combines dynamic geometry with one very small stamp.

Dynamic controller analysis solves the part where terrain matters most: storage location and upgrade capacity. The small stamp then locks together structures whose relative positions matter operationally: storage, terminal, manager, link, spawn, and a few local roads.

This avoids both extremes:

- a large fixed bunker that rejects irregular but usable terrain;
- a fully dynamic local brute-force search with many arbitrary tie-breakers.

The core search space is tiny: controller-area candidates multiplied by two mirror states, with one deterministic link fallback.

## Consequences

- Controller quality is preserved before core compactness is considered.
- The core has deterministic structure and predictable manager logistics.
- Core roads and structures never consume planned upgrader tiles.
- The link can adapt by one tile in constrained terrain without turning the whole stamp into a generic deformation system.
- Removing the unnecessary protruding road reduces false core failures and keeps the fallback system small.
- Some unusual rooms are deliberately unsupported rather than forcing special-case region behavior.
- Downstream systems can treat the chosen controller area and core as fixed reserved geometry.

## Next step: resource tree

The next planner stage is `planResourceTree.ts`.

It should connect the chosen core to:

- source 1;
- source 2;
- mineral.

The next design question is how to define the road root/frontier from the new small core and how to generate a merged resource tree while respecting:

- core structures and roads;
- reserved upgrade-chain tiles;
- terrain costs;
- later reuse by labs, rampart access, and extensions.

The previous prototype direction of using a Dijkstra-style distance map and preferring merged equivalent routes remains relevant, but it should now be reconsidered against the finalized small-core geometry rather than copied from the earlier dynamic-core prototype.

## Open questions

The following are intentionally left for later stages:

- exact resource-tree root/frontier and merge objective;
- source/mineral work-tile selection;
- dynamic lab placement relative to the final resource tree;
- extension growth root after removal of the old explicit `A` access tile;
- expected rampart boundary and internal access lanes;
- final RCL ordering and reclamation of upgrade tiles;
- later spawns, factory, power spawn, towers, and other late structures;
- final min-cut/rampart integration.

These should be decided from actual planner output rather than by adding speculative weights to the core selection.