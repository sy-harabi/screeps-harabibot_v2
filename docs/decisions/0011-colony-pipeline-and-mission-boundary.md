# Colony pipeline and mission boundary

Status: accepted
Date: 2026-09-21

## Context

The rewrite initially used one hierarchical abstraction for empire, colony, and harvesting work:

```text
EmpireOperation
└─ ColonyOperation
   └─ HarvestOperation
```

with a global `plan -> allocate -> execute` flow.

Implementing colony economy exposed that tightly coupled room-local work depends on explicit within-tick ordering. Harvesting, filling, upgrading, building, logistics, and similar responsibilities share colony state and frequently need to observe effects or requests produced earlier in the same tick. Forcing all of them through the same persistent-operation lifecycle adds indirection without creating real independence.

Long-lived cross-room goals such as attacks, claims, power-bank work, or remote defense have different lifecycle requirements and remain natural candidates for a persistent mission abstraction.

## Decision

### 1. Colony is an ordered local pipeline

Each owned room defines a colony. `runColonies()` iterates owned rooms and `runColony()` calls colony subsystems in explicit gameplay order.

Harvest is a colony subsystem, not a persistent operation.

As more systems are added, the intended shape is conceptually:

```text
runColony
├─ defense
├─ harvest
├─ upgrade
├─ build
├─ logistics
└─ ...
```

The exact order is gameplay logic and should remain visible rather than hidden behind a generic scheduler.

### 2. Mission is reserved for independent persistent goals

A mission is a long-lived goal with its own lifecycle, typically spanning rooms or requiring coordination beyond routine colony operation.

Examples include assault, claim, power-bank, and remote-defense work.

No generic mission framework is created until the first real mission requires it.

### 3. Creeps have exactly one owner

Creep ownership is represented by a discriminated assignment:

```ts
type CreepAssignment =
  | { type: "colony"; colonyName: string }
  | { type: "mission"; missionId: string }
```

`role` is separate from ownership.

`TickContext` scans `Game.creeps` once per tick and builds runtime rosters by colony and mission. Persistent owner-maintained creep-name lists are not the source of truth.

### 4. Shared scarce resources use explicit allocators

Systems may submit requests to shared allocators when multiple consumers compete for a scarce resource. Spawn time is the first example.

This does not imply a universal `plan/execute` interface for all systems.

### 5. Runtime state remains domain-owned

One-tick state stays local to the tick or subsystem call. Cross-tick disposable caches are owned by their domain and registered through `runtimeRegistry` when appropriate.

Harvest therefore owns its own cross-tick runtime cache rather than using a generic operation runtime.

## Reasons

- Colony execution order is real gameplay dataflow and is clearer when written directly.
- Routine colony systems do not have independent lifecycles that justify persistent operation records.
- Missions retain a useful semantic boundary for genuinely independent goals.
- Exclusive creep ownership avoids duplicated membership state.
- Domain-owned runtime data keeps lifecycle and invalidation responsibilities clear.
- Resource allocators remain available where arbitration actually provides value.

## Consequences

- The generic operation tree, operation runner, and operation runtime are removed.
- `Memory.operations` is removed.
- Harvest moves under `src/colony/harvest/`.
- The main loop runs colonies directly before spawn allocation and traffic resolution.
- Existing decision record 0010 remains useful history for why sources are not independent operations, but its `HarvestOperation` conclusion is superseded here.
