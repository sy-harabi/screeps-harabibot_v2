# Storage, persistence, and bot options

Status: accepted
Date: 2026-09-14

## Context

The old bot accumulated four different storage concepts:

- `dataStorage.temp`: data that exists only for the current tick. It is reset at the start of every loop and is used for per-tick memoization and shared intermediate results.
- `dataStorage.heap`: module/global-heap data that survives across ticks but disappears on a global reset. It is used for paths, targets, room/mission caches, `CostMatrix` objects, and other recomputable runtime data.
- `Memory`: persistent state that survives global resets. It contains missions, timers, manual state, and other data whose loss can change bot behavior.
- `RawMemory.segments`: large persistent data. The old bot stores base plans in owned-room segments and later moved large intel/source-info stores from `Memory` into segment-backed stores.

The distinction is useful, but the old names and ownership became unclear. `dataStorage` also became a broad container for unrelated room, creep, mission, cache, cost, segment, and temporary data.

The v2 rewrite already has `TickContext` for per-tick shared state and `OperationStore` for persistent operation records. Base planning is now mature enough that its storage format and runtime access pattern should be decided before colony execution starts depending on it.

Bot configuration also needs a clear distinction between algorithm constants committed with the code and user-controlled runtime options that should be changeable without a deploy.

## Decision

### 1. Per-tick data belongs to `TickContext`

Do not recreate the old `temp`/`tempDataStore` abstraction.

`TickContext` owns values whose lifetime is exactly one tick, including shared requests and per-tick memoization when sharing it through the context is useful.

Examples:

- owned room list
- spawn requests
- per-tick empire aggregates
- per-tick combat/intel calculations

If the amount of memoized data grows, `TickContext` may gain a dedicated cache field, but the lifetime remains explicit: a new context is created each tick.

### 2. Multi-tick volatile data is runtime data, not persistent state

Rename the old conceptual `heap` layer to **runtime** / **RuntimeStore** terminology.

Runtime data survives between ticks only while the current global environment survives. It must be safe to lose on a global reset.

Typical runtime data includes:

- decoded base plans
- paths and routes
- `CostMatrix` caches
- object/target lookups
- expensive derived room information

The invariant is:

> Losing all runtime data may cost CPU to rebuild, but must not change the durable intent or correctness of the bot.

`RuntimeStore` is not a parent container for domain stores. `BasePlanStore` and `OperationStore` remain domain APIs. A domain store may use runtime storage internally as a cache.

Avoid rebuilding the old all-purpose `dataStorage` god object.

### 3. `Memory` stores small, loss-sensitive persistent state

Use `Memory` when state must survive a global reset and is small/hot enough that segment loading is not justified.

Examples:

- `Memory.operations`
- sparse bot-option overrides
- durable scheduler/cooldown state when losing it would alter behavior
- manual commands or user intent

Do not put large recomputable caches into `Memory`.

`OperationStore` remains directly backed by `Memory.operations`. It is not attached to `RuntimeStore` and does not need a second runtime copy unless a measured performance reason appears later.

### 4. Segments store large persistent domain data

Use `RawMemory.segments` for data that must survive global resets but is too large or too cold for normal `Memory`.

Application code must not access `RawMemory.segments` directly. A low-level `SegmentManager` owns activation, reads, writes, and write scheduling. Domain-specific stores sit above it.

Expected hierarchy:

```text
Memory                          RawMemory segments
  |                                    |
OperationStore                    SegmentManager
                                       |
                                 BasePlanStore
                                 IntelStore
                                 SourceInfoStore
                                 ...
```

The persistent backing store and the runtime cache are separate concepts.

### 5. Base plans are segment-backed

`BasePlan` is large, stable, expensive to generate, and must survive global resets. Therefore the authoritative persistent copy belongs in segments rather than `Memory`.

`BasePlanStore` owns base-plan persistence and access. Its runtime path is:

```text
segment payload
    -> decode/unpack
    -> runtime BasePlan cache
    -> colony consumers
```

`Memory` does not contain the base-plan payload.

The store must distinguish these states:

```ts
type StoreResult<T> = { status: "loading" } | { status: "missing" } | { status: "ready"; value: T }
```

This distinction is required because an inactive/not-yet-loaded segment must not be interpreted as a missing plan. Otherwise every global reset could cause unnecessary replanning.

Expected `BasePlanStore` surface:

```ts
get(roomName: string): StoreResult<BasePlan>;
set(roomName: string, plan: BasePlan): void;
delete(roomName: string): void;
```

The exact API may evolve, but callers should not know segment IDs or serialization details.

### 6. Base-plan persistence format is separate from the runtime model

Keep the current readable `BasePlan` / `PlannedStructure` types as the runtime domain model.

Only the segment representation should be compact. For example, a planned structure may be serialized as a tuple containing a numeric structure type, packed room coordinate, RCL, and optional compact tag data.

Do not let the packed representation leak into normal planner or colony code.

The persisted payload must carry a schema/base-plan version so future planner changes can invalidate or migrate old plans deliberately.

### 7. Static configuration and runtime bot options are separate

Algorithm constants remain code/configuration committed with the bot. Examples include planner costs, search limits, thresholds that define an algorithm, and structure-layout constants.

User-controlled behavior switches belong to `BotOptions`. Examples include automation toggles, debug/visual switches, or features that should be changeable without deploying new code.

Defaults live in code:

```ts
const DEFAULT_BOT_OPTIONS: BotOptions = { ... };
```

`Memory.options` stores only sparse overrides, not a copy of every default.

Conceptually:

```ts
interface Memory {
  operations?: OperationsMemory
  options?: DeepPartial<BotOptions>
}
```

Effective options are the code defaults merged with the stored overrides.

This lets new code defaults take effect automatically for options the user has never overridden, while explicit user choices persist across global resets and deployments.

Prefer names such as:

```text
options.automation.*
options.visuals.*
options.debug.*
```

over the old broad `config.settings.*` / `config.test.*` split.

## Ownership summary

| Layer                    | Lifetime           | Purpose                                    | Examples                            |
| ------------------------ | ------------------ | ------------------------------------------ | ----------------------------------- |
| `TickContext`            | one tick           | shared transient data and tick memoization | owned rooms, spawn requests         |
| runtime / `RuntimeStore` | until global reset | recomputable multi-tick cache              | decoded plans, paths, cost matrices |
| `Memory`                 | persistent         | small loss-sensitive state                 | operations, option overrides        |
| segments                 | persistent         | large/cold domain data                     | base plans, intel, source info      |

Domain stores are owners of their data model and persistence policy. They are not children of `RuntimeStore`.

## Reasons

- Lifetime is visible from the abstraction used to store the value.
- A global reset has a simple contract: runtime data may disappear; persistent intent does not.
- Large data does not inflate normal Screeps `Memory` parsing/serialization.
- Domain code does not need to understand segment activation or packed formats.
- `TickContext` prevents the v2 rewrite from recreating a second global per-tick scratch object.
- Sparse option overrides separate user intent from code defaults and avoid stale copied defaults after deployments.
- Keeping stores independent avoids recreating the old `dataStorage` catch-all dependency.

## Consequences

- v2 needs a small low-level `SegmentManager` before `BasePlanStore` can be completed.
- Segment-backed consumers must handle a short `loading` state after a global reset.
- Base plans need explicit pack/unpack functions and a persistence schema version.
- `ColonyOperation` should stop calling `planBase()` unconditionally. It should request a plan from `BasePlanStore`, wait while loading, generate only when missing, persist the result, and then use the ready plan.
- Runtime caches may later be cleaned by age/last-use policies, but that is an optimization rather than persistence correctness.

## Implementation order

1. Add the minimal runtime-storage primitive needed by domain caches; do not design a generic cache framework yet.
2. Add `BotOptions` defaults, sparse `Memory.options` typing, and one resolver for effective options.
3. Implement the low-level `SegmentManager` activation/read/write lifecycle.
4. Add base-plan pack/unpack and versioned persisted payload types.
5. Implement `BasePlanStore` with `loading | missing | ready` semantics and runtime decoded-plan caching.
6. Change `ColonyOperation` to consume `BasePlanStore` and run `planBase()` only for a genuinely missing plan.
7. Add console helpers for inspecting/resetting base plans and setting/clearing bot-option overrides when the underlying APIs are stable.

## Alternatives considered

### Put `BasePlanStore` and `OperationStore` inside `RuntimeStore`

Rejected. Stores define domain ownership and persistence behavior; runtime storage is only one possible cache layer. Treating runtime storage as their parent conflates persistence with process-local caching.

### Store base plans directly in `Memory`

Rejected. Base plans are comparatively large and cold. Segments are a better persistence layer, while a decoded runtime cache keeps normal access cheap.

### Recreate `dataStorage.temp` and `dataStorage.heap`

Rejected. `TickContext` already models tick lifetime explicitly, and a broad shared storage object would restore the coupling the rewrite is intended to remove.

### Keep all bot settings in a source `config` object

Rejected for runtime behavior options because changing them requires a deploy and does not represent durable user overrides. Static algorithm constants still remain in code.
