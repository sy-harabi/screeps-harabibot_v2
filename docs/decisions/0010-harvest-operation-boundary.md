# Harvest operation boundary

Status: superseded by 0011
Date: 2026-09-19

## Context

The initial rewrite modeled each owned source as its own `OwnedSourceOperation`. That was a useful first step because miner spawning and execution were simple to attach to a concrete persistent object.

Further economy design exposed a mismatch between that operation boundary and the actual gameplay boundary.

Sources within one colony are not economically independent:

- they compete for the same spawn time;
- they share one hauler pool;
- hauling capacity allocated to one source changes the hauling fulfillment of every lower-priority source;
- local and remote sources must be compared in one economic ordering;
- reserver eligibility depends on whether the shared transport pipeline can exploit the increased remote throughput.

A source itself has little independent lifecycle. It is primarily a resource node with a miner assignment, path, endpoint, production target, and current fulfillment.

The rewrite should not create operations merely because Screeps exposes separate game objects.

## Decision

### 1. Replace per-source owned operations with one colony harvesting operation

The intended hierarchy is:

```text
EmpireOperation
└─ ColonyOperation
   ├─ HarvestOperation
   ├─ UpgradeOperation
   ├─ BuildOperation
   └─ ...
```

`HarvestOperation` owns the colony's harvesting economy:

- local source workforce;
- remote source workforce;
- the colony shared hauler pool;
- ordered source evaluation;
- mining and hauling fulfillment;
- remote reservation demand as part of harvesting economics;
- harvesting-related spawn requests.

The exact set of sibling colony operations may change later. This record only fixes the harvesting boundary.

### 2. Treat sources as state/entities, not operations

A local or remote source should be represented by derived or persistent harvesting state as needed, for example:

```ts
interface HarvestSourceState {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly distance: number
  readonly harvestPower: number
  readonly targetHarvestPower: number
  readonly haulingCapacity: number
  readonly targetHaulingCapacity: number
}
```

The exact shape is not prescribed.

A miner can belong to the harvest operation while carrying a `sourceId` assignment in creep memory. Source identity is worker assignment data, not necessarily operation identity.

### 3. Keep the shared hauling pool inside the harvest boundary

Haulers belong to the colony harvesting system, not to individual sources.

The harvesting system computes one ordered source snapshot, allocates theoretical hauling capacity through that order, and uses the same economic ordering when deciding spawn demand.

Runtime trip assignment may use additional transient information such as predicted source energy at arrival and per-tick pending pickup reservations, but it remains part of the same shared harvesting system.

### 4. Do not let operation traversal order define economic order

Planning and execution order are implementation details.

The harvesting system must explicitly sort or rank its sources and derive its state from current world state, operation-independent records, base-plan data, and tick-local runtime data.

The result must be the same whether source A or source B would otherwise have been visited first by an operation-tree traversal.

### 5. Do not introduce a RemoteOperation yet

Remote rooms initially remain state/entities managed by `HarvestOperation`.

A remote room may contain:

- one or more source states;
- reservation state;
- harvesting infrastructure state;
- danger or availability information needed by harvesting.

This avoids splitting a tightly coupled spawn-order and shared-hauler problem across multiple operations too early.

A `RemoteOperation` may be introduced later if the remote room develops a sufficiently independent lifecycle outside harvesting, for example:

- scouting and vision acquisition;
- suspension and reactivation;
- defense coordination;
- Invader Core handling;
- ownership transfer between colonies;
- other strategic state transitions.

Even if such an operation is introduced, miner/hauler economic allocation may remain owned by `HarvestOperation` if those decisions still depend on the colony-wide shared harvesting pool.

### 6. Operation granularity and code-module granularity are different

One operation does not imply one large source file.

The harvest implementation should be split into focused modules as complexity grows, for example:

```text
operations/harvest/
  harvestOperation.ts
  sourceState.ts
  miner.ts
  hauling.ts
  sourcePriority.ts
```

Operation boundaries describe gameplay responsibility and lifecycle. Module boundaries describe code organization.

## Reasons

### The shared constraints define the natural boundary

Spawn time and hauling capacity couple all harvesting sources together. A single harvesting operation can evaluate those constraints directly rather than reconstructing global state across many source-local operations.

### Source objects do not justify source operations

A source is persistent in the game world, but that alone does not make it an independent goal. Giving every physical entity an operation would create a deep tree without corresponding decision autonomy.

### The boundary matches future optimization work

When CPU is plentiful, the harvesting system can use spawn time to maximize useful income. When CPU later becomes limiting, the same harvesting boundary is the natural place to rank or trim marginal economic work under a CPU budget.

### It keeps ColonyOperation small without inventing unnecessary hierarchy

`ColonyOperation` remains the owner of major colony goals, while harvesting complexity moves into a dedicated subsystem. This avoids both a god-like colony operation and excessively fine-grained source operations.

## Consequences

- The current `OwnedSourceOperation` is expected to be removed when harvesting is implemented.
- Miner creep ownership should move from a source operation ID to the harvest operation, with `sourceId` or equivalent assignment data stored separately.
- Shared haulers naturally belong to `HarvestOperation`.
- Harvest spawn demand can be generated from one consistent ordered source state.
- The operation tree becomes smaller and better aligned with gameplay goals.
- README architecture documentation should be updated only after the code has actually been refactored.
- Remote operation boundaries remain deliberately open for future evidence.

## Alternatives considered

### Keep one OwnedSourceOperation per source

Rejected as the intended end state. It localizes miner code well, but it makes a tightly coupled shared-spawn/shared-hauler economy appear more independent than it really is.

### Put all harvesting directly in ColonyOperation

Rejected. Harvesting is already a substantial gameplay responsibility and is likely to grow with remotes, reservation, infrastructure, and CPU-aware economic control.

### Create one RemoteOperation per remote immediately

Deferred. Remote rooms have more lifecycle potential than individual sources, but current harvesting decisions remain strongly coupled through colony-wide spawn ordering and the shared hauler pool. Introduce the operation only when an independent remote lifecycle actually requires it.
