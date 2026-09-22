# Module-owned runtime lifecycles and cleanup

Status: accepted
Date: 2026-09-22

## Context

ADR 0007 established that disposable cross-tick runtime state should remain domain-owned while material long-lived caches are registered centrally for visibility.

The original bot demonstrated both sides of this trade-off. Its central `dataStorage.heap` made heap inspection and cleanup convenient, but shared `room.heap`, `creep.heap`, mission heap objects, and generic cache buckets allowed unrelated modules to attach fields to the same objects. Ownership and invalidation rules became implicit.

The first v2 runtime consumers exposed the same risk in a smaller form. A generic creep heap was shared by movement and logistics, while the cache registry only recorded cache sizes and did not yet run cleanup. Dead creep entries could therefore survive until a global reset.

The cost-matrix review exposed a related lifetime distinction: some matrices are stable across ticks, some are derived from the current tick, and some exist only for one path request. Treating all three as the same kind of cache either wastes allocations or makes invalidation unclear.

## Decision

### 1. Runtime state is owned by the module that understands it

Prefer module-specific runtime caches:

```text
movement.creeps
logistics.suppliers
harvest.colonies
upgrade.colonies
```

Do not use a generic `creepHeap`, `roomHeap`, or mission heap as a shared object where unrelated modules add arbitrary fields.

Consumers access runtime state through the owning module API. The runtime registry is not a service locator for reading another module runtime.

### 2. The registry owns scheduling and visibility, not stale-entry semantics

A registered cache may provide a cleanup callback and cleanup interval.

The registry decides **when** a cleanup callback runs. The owning module decides **what** is stale and deletes its own entries.

Cleanup schedules are deterministically staggered by cache name so caches with the same interval do not all sweep on the same tick.

The registry also exposes cache-size statistics and global clearing for diagnostics and global-reset-style tooling.

It does not provide generic TTL, LRU, serialization, memory-size estimation, or universal entity semantics.

### 3. Explicit lifecycle cleanup is preferred when a lifecycle event exists

When deletion is explicit, remove runtime immediately as part of that lifecycle:

```text
mission finishes -> mission runtime deleted
colony intentionally removed -> colony runtime deleted
source explicitly removed -> source-derived runtime deleted
```

Periodic cleanup remains a safety net for lifecycles without a reliable explicit hook, such as normal creep death.

Initial sweep intervals are guidelines rather than gameplay constants:

- Creep/entity runtime: sweep about every 100 ticks; delete entries whose entity no longer exists.
- Colony/mission runtime: sweep about every 500 ticks; delete entries whose owner no longer exists.
- Room-derived cache: sweep about every 100 ticks; a typical stale threshold is about 1000 unused ticks.
- Heavy decoded cache: add a roughly 1000-tick sweep only when needed; stale thresholds are domain-specific and may be 5000-10000 unused ticks.
- Scratch/high-water buffers: do not periodically clean them; retained capacity is intentional.

Intervals should be changed based on profiling and retained-object size, not for architectural symmetry.

### 4. Grow-only scratch buffers are not runtime leaks

Traffic and logistics typed-array scratch buffers intentionally retain their historical high-water capacity. They avoid repeated allocation and garbage-collection churn and are naturally bounded by the largest workload seen by that subsystem.

They should only gain shrink logic if profiling shows that rare spikes retain materially excessive memory.

### 5. Cost matrices follow three lifetimes

Cost matrices are classified by the lifetime of the information they contain.

#### Cross-tick base matrix

Structures, roads, and construction sites form a shared base matrix that is cached across ticks and treated as immutable by callers.

The API name should make this role explicit: `getBaseRoomCostMatrix()`.

#### Tick-derived matrix

Current hostile positions, defense reachability, damage fields, or similar current-tick world state belong to the subsystem that derives them. If multiple callers need the same matrix during the tick, that subsystem may build it once from the base matrix and cache it for the tick.

There is no central `tickCostMatrix` manager.

#### Request-specific overlay

Path-request policy such as edge avoidance, fleeing from the current goals, route-specific portal rules, or special creep avoidance belongs to the caller/search request.

Start from the shared base or tick-derived matrix and clone only when a request actually needs to mutate it. Navigator should prefer concrete typed options for real policies; a generic mutation callback should only be added when a concrete consumer requires it.

This yields the intended flow:

```text
cross-tick immutable base
          |
          v
domain-owned tick-derived matrix (optional)
          |
          v
request-specific clone/overlay (optional)
          |
          v
PathFinder.search
```

## Current implementation consequences

- Movement and logistics use separate creep runtime caches instead of a shared creep heap.
- Dead creep runtime is swept periodically.
- Harvest and upgrade colony runtime are swept when their owned colony no longer exists.
- Room-structure and base-room-cost caches use registry-scheduled cleanup, so abandoned entries can be removed even if their getter is never called again.
- `runtimeRegistry.getStats()` exposes registered cache entry counts.
- The base movement cost API is named `getBaseRoomCostMatrix()` and its returned matrix remains shared and read-only by convention.

## Reasons

- Keeps the original bot advantage of centralized heap visibility without recreating its shared heap ownership.
- Makes stale-data responsibility explicit and local to the module that understands the data.
- Prevents dead creep runtime and abandoned room runtime from accumulating for an entire global lifetime.
- Avoids paying a cleanup scan every tick while keeping stale retention bounded.
- Avoids unnecessary `CostMatrix.clone()` allocation and garbage-collection churn.
- Keeps the registry small instead of turning it into a generic caching framework.

## Alternatives considered

### Shared entity heap such as `getCreepHeap()`

Rejected for long-term use. It is convenient initially but recreates the original bot pattern where unrelated modules share one extensible object and lifecycle ownership becomes ambiguous.

### One universal cleanup interval

Rejected. Creep runtime, colony runtime, long-lived decoded data, and scratch buffers have different stale conditions and retention costs.

### Cleanup entirely inside each module

Rejected as the default. Domain ownership is correct, but distributed timers reduce observability and a cache that is never called again may never run its own cleanup.

### Registry-defined generic TTL/LRU policies

Rejected for now. The registry should schedule cleanup and expose diagnostics; eviction semantics remain domain-specific until concrete repeated patterns justify another abstraction.
