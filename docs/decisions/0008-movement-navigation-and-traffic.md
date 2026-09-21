# Movement navigation and traffic

Status: accepted
Date: 2026-09-17

## Context

The rewrite uses operations for persistent goals and capabilities for reusable mechanisms. The current miner calls `miner.moveTo(source)` when harvesting returns `ERR_NOT_IN_RANGE`. Movement needs a domain boundary that can grow with the bot's specialized economy and combat roles.

The original bot at `C:\projects\screeps\HarabiBot_3.0` provides the following observed behavior:

- `creepUtils.moveCreep()` checks movement state and arrival, manages path reuse and recovery, searches when necessary, and prepares a next step.
- `followByPath()` registers that step with the traffic manager. It already reconciles its cached index with the creep's observed position.
- The traffic manager resolves movement after the room and mission logic and then calls `creep.move()`.
- Some callers use movement failure to choose another action in the same tick. For example, the repairer in `roomManager.js` falls through to repair behavior when movement toward rampart construction sites returns `RETURN_FAIL`.
- The original traffic manager can displace creeps without a movement intent. Its working-area handling prefers positions inside the area but also permits positions outside it.
- Movement recovery can change pathfinding policies, including weakening Keeper avoidance after repeated failures.

Navigation and traffic were therefore already separate in the original bot. The rewrite should preserve that useful boundary while making policy, state ownership, and the movement contract explicit. The original implementation is reference material, not a specification.

This record defines intended behavior. The movement capability is not implemented by this documentation change.

## Decision

### 1. Operations choose goals; movement manages navigation; traffic assigns steps

| Owner               | Responsibility                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Operation / role    | Select destinations and working positions; choose risk policies; declare holds and any working-area constraints |
| Movement entrypoint | Check arrival and movement state; obtain or reuse a path; submit a preferred step and its constraints           |
| Pathing             | Build search costs, select room routes, search paths, and own path validity rules                               |
| Movement runtime    | Store disposable path state, observed progress, retry state, and movement diagnostics                           |
| Traffic             | Resolve competing steps, swaps, and permitted yielding; produce final assignments                               |
| Movement commit     | Issue at most one movement command per creep from the final assignments                                         |
| World               | Provide terrain, structures, room connections, and intel used by movement policies                              |

Movement must not infer strategy from role names. For example, the owned source operation chooses the mining position; movement only manages reaching it.

Within the caller boundary, the operation owns durable goals, assigned working positions or areas, and strategic risk policy. The role chooses its current action, immediate destination and range, and current-tick hold declarations within those decisions. This is a conceptual responsibility boundary, not a requirement for separate classes or files.

Use plain modules and small interfaces under `src/capabilities/movement/`. A public entrypoint may orchestrate several steps without owning every implementation detail. Splitting code into helpers is insufficient if callers can still mutate path cursors or recovery state directly.

### 2. Prepare paths synchronously and resolve traffic after operation execution

`moveCreep()` performs navigation during the call:

```text
moveCreep(creep, goals, options)
    -> replace the creep's previous movement intent for this tick
    -> validate input and check arrival / movement state
    -> reconcile observed position with navigation state
    -> reuse or search for a path
    -> select a preferred next step
    -> register the step and applicable constraints
    -> return the navigation status
```

Only shared tile allocation and movement command emission are deferred:

```ts
planOperationTree(rootOperation, context)

allocateSpawns()

executeOperationTree(rootOperation, context)

resolveTraffic()

segmentManager.endTick()
```

This preserves same-tick fallback decisions without requiring a second operation execution pass or a separate path query for ordinary movement callers. Traffic has all current-tick movement requests and constraints before it assigns positions.

Synchronous navigation does not know declarations made by roles that execute later. It prepares a route and preferred step, not a guaranteed tile reservation. Traffic must enforce the final constraints even when they prevent that preferred step. Established working positions can inform navigation when the owning operation makes that information available; do not add a universal planning pass solely for hypothetical future consumers.

The navigator must not call `moveTo()`, `moveByPath()`, or `move()` as part of path preparation. Movement commands belong to the commit stage.

### 3. Keep the public movement status small

The ordinary public entrypoint is `moveCreep(creep, goals, options?)`. Support one goal or several alternative goals, with an explicit range:

```ts
interface MoveGoal {
  readonly pos: RoomPosition
  readonly range: number
}

type MoveStatus = "arrived" | "pending" | "failed"
```

| Status    | Meaning                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `arrived` | The observed position currently satisfies a goal                                                                               |
| `pending` | The goal is not satisfied; navigation has submitted a step or is temporarily waiting                                           |
| `failed`  | The input or movement state prevents navigation, or no usable path was obtained under the current policy and search conditions |

`pending` may include fatigue, spawning, a current-tick hold, or an internal retry / CPU-budget delay. It does not claim that a movement command was emitted or that movement succeeded.

`failed` does not establish permanent unreachability. In particular, an incomplete bounded search is not proof that a room connection or destination is permanently inaccessible. Keep detailed failure and waiting reasons in movement diagnostics; expose them when a caller needs different behavior for different reasons.

Goals must be nonempty, and ranges must be valid nonnegative values. Multiple goals mean alternatives, not a sequence of destinations. The detailed option surface should grow with concrete consumers rather than reproduce the original option collection immediately.

Operations reissue their desired movement each tick. `pending` does not transfer persistent goal ownership to movement, and cached paths must not replay movement after the operation stops requesting it.

### 4. Hold only when explicitly requested in the current tick

**A creep is fixed by traffic if and only if `holdPosition(creep)` was called for it in the current tick. Otherwise, yielding is permitted.**

Yield permission is not an instruction to move. Traffic may leave a creep in place and must still respect physical movement limits and applicable movement constraints.

| Current-tick state                                 | Traffic behavior                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `holdPosition(creep)` was called                   | Keep the creep at its observed current position; do not displace it or issue a movement command for it |
| No hold and a movement request exists              | Prefer the requested step; permitted alternatives may be used to resolve traffic                       |
| No hold and no movement request exists             | Stay unless a legal yielding move helps resolve traffic                                                |
| No hold and the movement goal is already satisfied | Yielding remains permitted; arrival does not implicitly hold the creep                                 |

Holds are tick-local and must be renewed each tick. Never persist a hold in `Memory`, carry it forward through a path cache, or infer it from a role name.

A hold takes precedence over ordinary movement requests regardless of call order. Calling `holdPosition()` after `moveCreep()` suppresses the queued step. Calling `moveCreep()` after a hold must not remove or bypass that hold. If the goal is not already satisfied, the held creep reports `pending` and remains fixed for that tick.

An operation that wants a stationary worker must call `holdPosition()` explicitly while it is working. For example, the future miner behavior at an assigned mining position can follow this shape:

```ts
if (miner.pos.isEqualTo(miningPosition)) {
  holdPosition(miner)
} else {
  moveCreep(miner, { pos: miningPosition, range: 0 })
}

if (miner.pos.inRangeTo(source, 1)) {
  miner.harvest(source)
}
```

No `allowYield()` call is required to opt into ordinary yielding. When a role needs constrained yielding, such as an upgrader that must preserve its working or energy-transfer positions, add a way to declare the valid yielding area. The operation chooses that area, and it does not override an explicit hold.

An unheld creep may still be unable to move because of fatigue, body limitations, obstacles, or the absence of an allowed destination. That is a movement limitation, not an implicit hold. Holds constrain the bot's assignments; room-edge or portal transitions still require observation and reconciliation with the game state.

### 5. Define current-tick request replacement independently of holds

Maintain at most one preferred movement intent per creep for the current tick. A later ordinary movement call replaces the earlier ordinary intent, including when the later call returns `arrived`, `pending` without a step, or `failed`.

For example, if a caller first requests movement toward A and then switches to B, an early return for B must not leave A's step queued. Replacing an ordinary intent must not clear the independent current-tick hold or other applicable constraints.

Movement priority resolves conflicts between creeps. It must not silently choose between different goals submitted for the same creep; goal selection remains the caller's responsibility. Repeated calls in one tick must not increment blocked or observed-progress counters multiple times.

### 6. Reconcile path progress with observed movement

Path progress represents where the creep is relative to a path, not how many movement requests have been submitted. Check the cached cursor and nearby path positions first, then attempt a valid local rejoin or search when necessary.

Path reuse must account for:

- whether the endpoint still satisfies the current goals;
- whether the path is compatible with the current movement policy;
- whether the creep can follow or rejoin it from its observed position;
- whether the next step remains usable;
- changes in relevant world information or movement costs.

Do not advance a cursor merely because traffic selected a step or `creep.move()` returned `OK`. On the next tick, reconcile the actual position, including yielding displacement, failed movement, room transitions, and eventually portal transitions.

Record traffic decisions and emitted movement attempts separately from observed results. Intentional traffic waiting, fatigue, and an emitted move that did not occur are different outcomes. Navigation may use those outcomes to decide whether to preserve, rejoin, or invalidate its path.

Recovery should follow explicit rules: preserve paths during ordinary waiting, invalidate confirmed blocked steps, and use bounded local recovery or repathing after repeated lack of progress. Exact thresholds remain implementation choices. Recovery must not silently relax a caller's risk policy.

Recovery should invalidate only the smallest scope justified by observed evidence. A failed step at a room exit or a bounded path search does not by itself invalidate a room connection. Preserve the room route when the evidence only requires replacing a path; reconsider the route when relevant world information or policy justifies it. Route reconsideration must remain consistent with the caller's policy and must not rewrite world connectivity facts based on a local failure.

Whether an obstruction is temporary, which navigation state needs invalidation, and which status the call returns are separate questions. Temporary danger may invalidate the current path immediately. Returning `failed` does not require exhausting a fixed sequence of local retries, repathing, and rerouting, and does not establish strategic failure. The caller retains responsibility for changing or abandoning the goal.

Prefer descriptive state names such as `cachedPath`, `nextPathIndex`, `lastMoveAttempt`, `consecutiveBlockedTicks`, and `retryAt`. These illustrate meaning and units; the final storage representation is not fixed here.

### 7. Separate movement constraints from search preferences

The operation selects the risk policy. Movement translates that policy and world facts into route rules, path costs, and traffic constraints.

Traffic must preserve actual walkability, explicit risk restrictions, holds, and declared yielding-area restrictions. It must not move a creep into a forbidden area simply to improve congestion.

Do not equate every `255` in a pathfinding matrix with a permanent traffic prohibition. For example, a tile excluded from a search because another creep currently occupies it may be a valid traffic destination if that creep vacates it. Search budgets and route-search narrowing also do not automatically define strategic movement prohibitions.

Keep the distinction between:

- physical or policy restrictions that all final assignments must satisfy;
- current occupancy that traffic may resolve through coordinated moves;
- preferences and search restrictions used to find a useful route efficiently.

Shared cost matrices must not be modified by request-specific overlays. Body-aware cost caching must account for relevant body, boost, damage, and load changes when that feature is introduced.

Named policy presets may package common choices, but do not mix role categories, risk policy, and search purpose into one exhaustive profile enum. Flee changes the search objective; combat and civilian creeps may both need it. Add the concrete API when its consumer is implemented.

For a future mineral operation, the following example assumes travel through an SK room is permitted but entering Keeper danger zones is forbidden by the selected policy:

```text
The operation assigns a mining position and selects the risk policy.
The role requests movement toward that position.
World supplies observed Keeper information.
Pathing checks the remaining path against the selected policy.
If the path violates that policy, movement stops following it.
Movement attempts a bounded local repath while retaining the room route
unless evidence also warrants reconsidering that route.
Traffic applies the same risk restrictions to yielding alternatives.
The caller receives pending or failed according to the existing contract.
Recovery never weakens the caller's risk policy.
The caller decides whether to change the goal or policy.
```

Keeper presence alone does not invalidate every path through the room. This example illustrates the ownership contract; it does not add SK behavior to the first implementation slice.

### 8. Keep traffic resolution bounded and explicit

Traffic considers all relevant controlled occupants, including creeps without requests that are eligible to yield and creeps that are held or physically unable to move. It must not rely only on the list of requested moves.

A preferred step and staying in place are enough to begin defining the interface. Multiple ranked candidates can be introduced as congestion handling grows. Every alternative must respect the creep's constraints and have a reasonable path-following or rejoin interpretation.

Do not choose an algorithm solely from a recursive-push sketch. Swap and cycle handling, reservation rollback after failed attempts, and search bounds need explicit behavior when the solver is implemented. Exact scoring and candidate generation remain open implementation details.

Conflicting requests should use explicit traffic priority and a defined tie-break rule rather than operation traversal order. If aging is needed, keep it bounded or within a priority class so ordinary waiting does not automatically outrank urgent movement.

Tactical consumers may eventually use a direct-step API without invoking PathFinder. An exact tactical step must not be silently replaced by an alternative unless its contract permits that. Group movement can later reserve several moves together, but bot-side reservation does not guarantee that every engine movement succeeds; observed results still determine recovery.

### 9. Keep state ownership and lifetime explicit

| Data                                                                         | Owner and lifetime                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Persistent destinations, source assignments, strategic decisions             | Operation / role state in `Memory`, when persistence is required |
| Preferred steps, holds, yielding constraints, occupancy indexes, assignments | Movement / traffic tick-local state                              |
| Creep paths, cursors, observed-attempt history, retry state                  | Movement-owned cross-tick runtime                                |
| Shared paths, room routes, cost matrices                                     | Pathing-owned cross-tick runtime                                 |
| Terrain, structures, and intel facts                                         | The relevant world subsystem                                     |

Tick-local state may be maintained inside the capability with an explicit `Game.time` reset, following the current spawning queue's approach. Do not register per-tick requests as long-lived runtime caches or add a general movement service container to `TickContext`.

Register long-lived runtime caches through `runtimeRegistry`, following [ADR 0007](0007-runtime-cache-ownership-and-registry.md). Domain code owns cache meaning, invalidation, and cleanup; the registry provides lifecycle visibility, not arbitrary data access. Remove creep runtime when the creep no longer exists, and define cleanup for shared caches as their consumers appear.

A global reset may discard paths and diagnostics. Operations must be able to reestablish their goals and current-tick holds, and movement must rebuild navigation without changing durable intent.

### 10. Use the base plan without confusing it with the current world

The current `BasePlan` stores the planned storage coordinate and planned structures with optional resource tags. An operation can use the tagged source-container position to choose a mining position.

Planned roads are not necessarily built roads, and planned buildings are not necessarily current obstacles. Use the observed world for actual movement costs and walkability; introduce plan-based preferences separately when useful.

The final base plan does not currently contain ordered hauling paths. Shared hauling navigation will therefore need a concrete path derivation step rather than treating the structure list as a route.

The expected ownership is a reusable path plus a cursor per creep. Movement/pathing owns the derived runtime path; the operation owns its endpoints and purpose. Decide whether callers use `moveCreepByPath()` or a path option on `moveCreep()` when hauling is implemented. At that point, specify whether a supplied path is mandatory or a reusable hint, and define rejoining and reverse traversal accordingly.

## Reasons

- Keeps existing same-tick movement-failure consumers straightforward.
- Preserves the original separation between navigation and traffic without copying its broad option and shared-heap structure.
- Allows ordinary yielding by default while protecting explicitly held workers.
- Gives specialized roles control over their goals and working constraints.
- Separates observed progress from intended movement, so traffic adjustments do not corrupt path state.
- Matches the accepted operation and runtime ownership direction while supporting a small first gameplay consumer.

## Consequences

- Roles must explicitly renew holds each tick when displacement is unacceptable. Neither arrival nor the absence of a movement request protects a worker's position.
- Navigation results are synchronous, but traffic acceptance and actual movement are not guaranteed by that result.
- Pathing may prepare a preferred step before another role declares a hold; final traffic constraints take precedence.
- Normal movement, future direct steps, and future group requests must converge on the same final movement commit boundary.
- The final policy types, cache representation, traffic algorithm, and module subdivision remain open until concrete consumers require them.

## Alternatives considered

### Defer all navigation until after operation execution

This gives navigation the complete request set and may help central search scheduling. It also removes synchronous path-preparation results from ordinary callers and complicates existing same-tick fallback behavior. Keep synchronous navigation and defer traffic allocation instead.

### Hold every creep without a movement request

Not selected. Absence of a request permits yielding. Only an explicit `holdPosition()` call fixes the creep for the current tick, subject to physical game behavior.

### Automatically hold creeps when their goals are satisfied

Not selected. Arrival is an observation, while holding is an explicit current-tick declaration by the role.

### Port the original movement utilities wholesale

Not selected. Preserve useful behavior such as path reuse, observed cursor recovery, and deferred traffic execution while giving policies and runtime data clear owners.

## Implementation sequence

1. Introduce the movement entrypoint, same-room path search, a small registered creep-path cache, observed cursor reconciliation, current-tick traffic registration, basic assignment/commit, and `holdPosition()`.
2. Replace the miner's direct `moveTo()` call and explicitly hold it while occupying its working position. Keep this slice deployable.
3. Add hauling behavior, then extend shared paths, reverse traversal, yielding, and congestion recovery around its actual needs.
4. Add constrained yielding for upgraders, room routing and risk policies for remote consumers, and direct-step/group behavior for tactical consumers when those systems are implemented.

Do not create empty framework modules for every future feature. File organization should follow concrete ownership as implementation grows.

## Validation expectations

When implementing the first slice, verify that:

- a miner reaches its goal, reuses a valid path, and holds its working position only when its role requests a hold;
- an unheld creep with no move request can yield, and an arrived creep is not implicitly held;
- a hold blocks both requested movement and yielding regardless of call order, and expires on the next tick unless renewed;
- a later movement call cannot leave an earlier goal's step queued after returning without a step;
- traffic emits at most one movement command per creep and respects applicable constraints;
- fatigue, traffic waiting, yielding displacement, and observed movement produce appropriate cursor and recovery behavior;
- a global reset loses disposable caches without losing operation intent.

Extend verification to swaps, cycles, constrained yielding, room transitions, shared-path rejoining, and tactical movement when those features are introduced. Use focused tests and in-game observation appropriate to each implemented slice; this design record does not claim those checks have already passed.

When room routing and risk policies are introduced, also verify that local failures do not invalidate room connections without supporting evidence, and that both repathing and traffic alternatives preserve the selected risk restrictions.

## References

- [Rewrite context](../rewrite-context.md)
- [ADR 0006: Storage, persistence, and bot options](0006-storage-persistence-and-bot-options.md)
- [ADR 0007: Runtime cache ownership and registry](0007-runtime-cache-ownership-and-registry.md)
- Current consumers and integration points: `src/operations/ownedSource/miner.ts`, `src/main.ts`, and `src/capabilities/spawning/spawnQueue.ts`.
- Original implementation inspected: `src/creepUtils.js`, `src/pathUtils.js`, `src/screeps-traffic-manager.js`, and `src/roomManager.js` in the read-only original repository.
- [Screeps movement API](https://docs.screeps.com/api/#Creep.move), [PathFinder search](https://docs.screeps.com/api/#PathFinder.search), and [tick execution](https://docs.screeps.com/game-loop.html).
