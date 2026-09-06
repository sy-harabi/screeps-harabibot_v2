# HarabiBot Rewrite Context

This project is a TypeScript rewrite of HarabiBot. The original bot at
`C:\projects\screeps\HarabiBot_3.0` is read-only reference material, not a specification.

The user normally writes production code. The agent acts mainly as an architecture advisor,
reviewer, and TypeScript mentor. Inspect the relevant original implementation before proposing a
rewrite, and do not invent Screeps strategy when the user's knowledge is required.

## Direction

- Grow a playable bot through vertical slices instead of translating utilities in isolation.
- Prefer plain modules, explicit data flow, and small interfaces over framework machinery.
- Operations own persistent goals and coordination.
- Capabilities provide reusable mechanisms such as spawning, movement, and logistics.
- World modules provide map, room, and intel information.
- Keep persistent state separate from per-tick requests, allocations, indexes, and caches.
- The standalone planner lab has been abandoned. Target the Screeps runtime and use
  in-game `RoomVisual` for planner visualization. Do not add abstractions or change
  bot interfaces solely to support a browser or offline planner lab.

## Current operation model

- `EmpireOperation` is the root operation.
- Each owned room has one child `ColonyOperation`.
- Operation state is a discriminated union of plain serializable records.
- Records are stored directly by ID in `Memory.operations`.
- Add an outer Memory wrapper only when real persistent metadata requires one.
- The empire currently creates colony records through the operation store.

## Current priority

Finish the base planner as the first major subsystem. This is an intentional exception to the
usual smallest-slice preference because the planner is foundational, independently visualizable,
important to the user, and a system the user wants to design fully before source management.

Preserve the original bot's specialized economy roles. Do not introduce a generic bootstrap worker
without a separate design decision.
