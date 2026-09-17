# Runtime cache ownership and registry

Status: accepted
Date: 2026-09-15

## Context

The old bot used a central `dataStorage.heap` object for data that should survive across ticks but may be lost on a global reset. It contained room, creep, mission, cost-matrix, segment, generic cache, and other runtime data.

That design had an important operational advantage: all long-lived global data was visible from one place. This made it easier to inspect heap growth, clean stale entries, and discover forgotten caches later.

However, the same design also blurred ownership. Unrelated systems could attach arbitrary fields to shared room/creep/mission heap objects or add new top-level heap buckets. Over time this made it harder to answer:

- which subsystem owns a value,
- who is responsible for invalidation,
- when an entry should be removed,
- whether the value is persistent state or merely a cache,
- whether a cache can safely disappear on global reset.

A fully domain-local approach also has a weakness. If every module simply declares its own module-level `Map`, a developer can accidentally create a long-lived cache and forget to expose it to cleanup/diagnostic tooling. Later, there may be no central way to enumerate all runtime allocations.

Therefore the v2 bot should preserve centralized visibility without centralizing data ownership.

## Decision

Runtime data ownership is distributed by domain, but all long-lived runtime caches should be registered in a central runtime registry.

The registry is responsible for lifecycle visibility and diagnostics, not for the semantic ownership of the cached data.

Conceptually:

```text
BasePlanStore owns base-plan cache ─┐
Pathing owns path cache ────────────┼─> RuntimeRegistry
IntelStore owns intel cache ────────┤    stats / inspection / cleanup
Room systems own room cache ────────┘
```

Domain code should normally access caches through domain APIs, not through the registry.

For example:

```ts
const basePlanCache = runtimeRegistry.createCache<string, BasePlan>("basePlans")
```

The `BasePlanStore` still owns the meaning, population, invalidation, and persistence policy of `basePlanCache`. Other systems should call `BasePlanStore`, not `runtimeRegistry.get("basePlans")`.

The registry exists so the bot can later provide tooling such as:

```ts
runtimeRegistry.list()
runtimeRegistry.stats()
runtimeRegistry.clear("basePlans")
runtimeRegistry.clearAll()
```

and console helpers such as:

```text
bot.runtime.list()
bot.runtime.stats()
```

## Scope

Use the registry for data that:

1. survives across ticks,
2. lives only in the JavaScript global environment,
3. can safely disappear after a global reset,
4. may grow enough that inspection or cleanup matters.

Examples:

- decoded base plans,
- path caches,
- cost-matrix caches,
- room-derived caches,
- creep-derived runtime state,
- operation-derived runtime state,
- decoded segment data when owned by `SegmentManager`.

Do not use the runtime registry for:

- one-tick data (`TickContext`),
- durable bot state (`Memory`),
- large durable data (segments),
- plain constants,
- short-lived local variables.

## Ownership rule

The central registry must not become a replacement for the old `dataStorage.heap` god object.

This is discouraged:

```ts
runtime.basePlans
runtime.paths
runtime.costs
runtime.rooms
runtime.creeps
runtime.operations
runtime.someNewThing
```

when arbitrary modules directly read and write those fields.

Instead, cache ownership remains explicit:

```text
BasePlanStore      -> basePlan cache
Pathing            -> path/cost caches
IntelStore         -> intel cache
SegmentManager     -> decoded segment cache
Room runtime API   -> room-scoped runtime data
Creep runtime API  -> creep-scoped runtime data
Operation runtime  -> operation-scoped runtime data
```

The registry merely knows that these allocations exist.

## Entity-scoped runtime data

The old bot showed that room, creep, and mission/operation runtime data can legitimately be shared across multiple subsystems.

For those cases, use a dedicated API such as:

```ts
getRoomRuntime(roomName)
getCreepRuntime(creepName)
getOperationRuntime(operationId)
```

rather than allowing arbitrary access to a central map.

Whether these APIs internally use individually registered caches or a shared entity-runtime module can be decided when the first concrete use case appears.

Do not create a large generic `RuntimeStore` interface ahead of actual requirements.

## Initial implementation direction

Start with a small registry rather than a generic caching framework.

Possible shape:

```ts
interface RuntimeCacheInfo {
  readonly name: string
  readonly size: () => number
  readonly clear: () => void
}

class RuntimeRegistry {
  private readonly caches = new Map<string, RuntimeCacheInfo>()

  createCache<K, V>(name: string): Map<K, V> {
    if (this.caches.has(name)) {
      throw new Error(`Runtime cache already registered: ${name}`)
    }

    const cache = new Map<K, V>()

    this.caches.set(name, {
      name,
      size: () => cache.size,
      clear: () => cache.clear(),
    })

    return cache
  }

  // list / stats / clear APIs can be added when needed.
}
```

This is intentionally minimal. Do not initially add TTL, LRU, automatic eviction, memory-size estimation, generic serialization, or complex callback registration.

Those features should only be introduced after a concrete cache requires them.

## Cleanup policy

Not every cache should use the same cleanup rule.

Examples:

- creep runtime: delete when the creep no longer exists,
- operation runtime: delete when the operation is removed,
- room runtime: may use last-access / TTL cleanup,
- base-plan decoded cache: generally small enough to keep until global reset unless room count or plan size makes eviction useful,
- path/cost-matrix cache: may eventually need TTL or size limits.

Therefore cleanup policy belongs to the owning domain. The registry may expose a central place to trigger or inspect cleanup, but it should not impose one universal eviction algorithm.

## Development rule

Avoid creating unregistered module-level long-lived caches such as:

```ts
const cache = new Map()
```

when the map is intended to live across ticks.

Prefer creating it through the runtime registry so later inspection can reveal its existence.

Small purely internal caches may be exempted if their lifetime/size is obviously bounded, but this should be the exception rather than the default.

## Reasons

- Preserves the old bot's strongest property: global runtime memory can be audited from one place.
- Makes forgotten or unexpectedly growing caches easier to discover.
- Keeps cache ownership and invalidation logic close to the subsystem that understands the data.
- Avoids recreating `dataStorage.heap` as a universal dependency.
- Allows future console diagnostics without forcing all systems to expose their internal maps directly.
- Makes global-reset semantics explicit: registered runtime caches are disposable.

## Consequences

- A small `RuntimeRegistry` will eventually be added, likely under `src/kernel/` or a similarly low-level location.
- Domain stores such as `BasePlanStore` may use registered runtime caches internally.
- `RuntimeRegistry` should not become a service locator for reading arbitrary cached data.
- Runtime cache statistics can later be exposed through the planned `global.bot` console API.
- Review should flag large cross-tick `Map`/`Set` allocations that bypass the registry without a clear reason.

## Alternatives considered

### Central `RuntimeStore` containing all data

Rejected as the default. It provides excellent visibility but recreates the ownership ambiguity and coupling of the old `dataStorage.heap` design.

### Fully domain-local unregistered caches

Rejected as the default. Ownership is clean, but it becomes difficult to discover forgotten global allocations or audit total runtime memory growth.

### Central registry with domain ownership

Accepted. It keeps centralized visibility and lifecycle tooling while leaving semantic ownership in the appropriate subsystem.

## Implementation timing

Do not implement the registry merely to have the abstraction available.

Implement it when the first real cross-tick runtime cache is introduced. `BasePlanStore` is a likely first consumer because it will need a decoded plan cache on top of segment persistence.

At that point, implement only the registry functionality required by that cache, then expand it as real runtime-cache use cases appear.
