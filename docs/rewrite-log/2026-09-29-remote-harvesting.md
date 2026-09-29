# Remote harvesting

Date: 2026-09-29  
Related commits: `3650acc7`, `35dc4936`, `d848bd4b`, `1457fab5`, `35bb7f56`, `91646d9e`, `189ce02c`

## Goal

Extend the colony harvest system from owned sources to remote sources.

The target was to support remote planning, miners, shared haulers, reservation, and economy accounting without introducing a separate remote operation or scheduler.

## Starting point

The bot already had an owned-room harvest system with miners, a shared hauler pool, source ordering, and source-economy estimates.

RoomIntel and Explore scouting were also available, so the bot could discover nearby rooms and their sources.

Remote mining therefore mostly required connecting those systems and deciding which data belonged to intel, persistent harvest planning, and runtime harvest state.

## First implementation and rollback

The first remote-mining implementation added remote assignment, remote source paths, remote-specific data, and reserver behavior on top of the existing source-data model.

As the implementation grew, several representations of the same source started overlapping. Source identity and position, colony assignment, path information, mining state, and economy data were stored or derived in different places without a clear boundary between them.

Rather than continuing to extend that structure, the remote implementation was removed in `35dc4936` and development returned to the pre-remote harvest baseline.

The remote system was then rebuilt with a smaller persistent model.

## Data model

The rebuilt version separates source-related data by lifecycle.

```text
RoomIntel
  observed source and controller state

HarvestRoomPlan
  colony assignment and source paths

HarvestRoomState / HarvestSource
  current-tick harvesting state

HarvestRuntime
  disposable derived caches
```

RoomIntel remains the source of observed world facts such as source identity and coordinates.

HarvestRoomPlan stores the colony-relative information needed to use a room, mainly the planned paths to its sources.

Current miner power, hauling capacity, reservation state, stored energy, and other per-tick values are derived into harvest state rather than persisted.

## Remote planning

Remote rooms are assigned to a colony using nearby room intel and route information.

Within a remote room, sources are planned nearest-first. Later sources may reuse paths already planned for nearer sources, allowing multiple source paths to share part of the route back to the colony.

The resulting source paths are persisted as part of the HarvestRoomPlan.

## Harvest traversal and reservation

Remote harvesting remains part of the colony harvest system.

Harvest now processes the owned room first, followed by remote rooms ordered by the distance of their nearest source. Sources inside each room are also processed by distance.

This traversal is also used for shared hauler allocation and harvest spawn priority.

Reservation is handled at room scope because it changes the production rate of every source in that room. A neutral remote produces at the lower unreserved rate, our reservation enables normal source production, and a foreign reservation prevents harvesting until it is removed.

Reserver upkeep is therefore accounted for once per remote room rather than once per source.

Harvest submits at most one spawn request per tick, but it continues traversing the remaining sources so income, spawn usage, and shared hauling capacity are still calculated for the entire colony.

## Hauling

Remote mining also exposed a problem with using path length as a direct estimate of hauling time.

An empty hauler has enough MOVE parts to cross both plains and swamps at one tile per tick, while a loaded hauler does not. The two directions are therefore calculated separately:

```text
empty trip:  plain 1 / swamp 1
loaded trip: plain 1 / swamp 5
```

The resulting cycle travel time is used when calculating required hauling capacity and hauler economy.

This allows the current remote system to model roadless harvesting before remote road construction is implemented.

## Work completed

- added remote-room assignment and source-path planning;
- added remote sources to the colony harvest traversal;
- kept one shared colony hauler pool for owned and remote sources;
- added remote miner spawning and execution;
- added reserver spawning, reservation, and foreign-reservation attack behavior;
- made source production depend on reservation state;
- included reserver upkeep in harvest income and spawn-usage estimates;
- added separate empty and loaded hauler travel calculations;
- extended harvest visuals with remote economy, reservation, container energy, and dropped energy information.

## What we learned

Source data became easier to manage after observed world state, persistent planning data, tick-local state, and disposable runtime caches were separated by lifecycle rather than combined because they described the same game object.

## Result

The colony harvest system can now operate owned and remote sources through the same source ordering, shared hauler pool, spawn demand, and sustainable-income calculation.

Remote reservation is included in the same economy model instead of being treated as a separate subsystem.

Remote infrastructure construction, remote defense, suspension policy, and other higher-level remote lifecycle behavior remain outside the current implementation.
