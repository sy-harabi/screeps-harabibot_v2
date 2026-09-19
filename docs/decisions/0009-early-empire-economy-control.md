# Early-empire economy control and spawn-driven remote frontier

Status: accepted
Date: 2026-09-19

## Context

The rewrite is reaching the point where owned-source mining, hauling, upgrading, and later remote mining must compete for the same finite spawn time.

The early empire has a clear strategic objective: maximize sustainable controller progress, measured as long-run `upgrade/tick`, under finite spawn time and CPU. Energy income is important because it supports controller progress, but it is not the objective by itself. Later in the empire lifecycle, energy must also fund warfare and other strategic sinks, so this objective is intentionally scoped to early empire development rather than the whole game.

The original bot contains two related control systems:

- `roomUtils.getEnergyLevel(room)` compresses room energy into one scalar. Below the RCL-dependent energy standard, the value is approximately a reserve ratio scaled to 100. Above the standard, each additional level represents 1,500 energy.
- `resourceUtils.getEmpireEnergyLevel()` applies the same idea across terminal rooms, using the sum of their room energy standards and scaling surplus by room count.

These values are convenient, but they combine two different meanings into one artificial unit:

- reserve sufficiency below the standard;
- discretionary surplus above the standard.

Many consumers do not actually need a generic level. Emergency logic wants reserve sufficiency, optional spending wants surplus, and room-to-room balancing wants donor surplus and receiver deficit.

The original bot also explicitly selects a remote portfolio from net income and spawn usage, then tries to maintain the selected sources. An alternative discussed during the rewrite is to let spawn contention determine the effective remote frontier: high-value work is requested first, while increasingly marginal remote work simply fails to receive replacement spawn time.

Harvesting is also coupled across sources. Local and remote sources compete for the same spawn time, while haulers form a shared colony pool. A source's hauling fulfillment therefore depends on how much shared hauling capacity has already been allocated to higher-priority sources. Spawn planning must treat the harvesting economy as one ordered system rather than as independent source-local decisions.

Remote infrastructure complicates this. If workforce pressure repeatedly causes remotes to open and close, rebuilding roads, containers, and reservation state can erase much of the theoretical gain. Infrastructure therefore needs a slower lifecycle than workforce assignment.

## Decision

### 1. Optimize early empire economy for sustainable upgrade/tick

During early empire development, the economy is evaluated by the sustainable controller progress it enables, not by maximum raw energy income.

Income, spawn time, CPU, infrastructure, and reservation are inputs to that objective.

This does not define the permanent whole-game objective. As the empire matures, the resource allocator must also support warfare, defense, strategic reserves, power processing, and other sinks.

### 2. Do not introduce a generic `energyLevel` unit in v2

Represent the underlying quantities directly.

A room energy state should conceptually expose values such as:

```ts
interface RoomEnergyState {
  readonly total: number
  readonly reserve: number
  readonly reserveRatio: number
  readonly surplus: number
  readonly deficit: number
}
```

where:

```text
reserveRatio = total / reserve
surplus      = max(0, total - reserve)
deficit      = max(0, reserve - total)
```

The exact interface and ownership are implementation details; the important decision is that callers should consume quantities with clear units and meaning rather than a shared synthetic scale.

Empire-level energy state should follow the same principle. Useful values may include total reserve, reserve ratio, total surplus, and surplus per room when empire-size normalization is useful.

Examples:

- emergency and survival gates should use reserve sufficiency;
- optional spending should use actual surplus or a named budget;
- room balancing should compare actual donor surplus and receiver deficit;
- future warfare should use explicit war chest, income, boost reserve, or other purpose-specific budgets rather than overloading a generic energy scalar.

### 3. Upgrader admission remains a separate unresolved decision

This record does not choose the exact post-storage rule for spawning another upgrader.

Two useful ideas remain under consideration:

- a reserve/surplus feedback controller;
- an energy-commitment rule that subtracts the future energy consumption of already spawned upgraders, such as remaining `WORK * TTL`, before admitting another upgrader.

A hybrid is also possible.

Whichever rule is selected later should operate on explicit energy quantities. It should not require reintroducing a generic `energyLevel` merely to express the control law.

### 4. Let spawn contention create the economic remote frontier

Do not require an economic optimizer to first choose an exact number of active remotes.

Instead, request useful work in priority order. When spawn capacity becomes limiting, lower-priority remote workforce naturally stops receiving replacement time. The resulting maintained set is the effective economic frontier.

This applies to economic admission only. Independent upper-level constraints may still forbid or suspend a remote because of:

- CPU budget;
- danger or hostile control;
- path validity;
- diplomacy;
- strategic policy;
- other non-economic constraints.

A remote does not need to flip between explicit economic ON/OFF states merely because its workforce is temporarily underfilled.

### 5. Evaluate harvesting as one ordered shared-capacity system

Local and remote sources that share a colony's spawn time and hauler pool must be evaluated together.

The harvesting planner should:

1. build one economically ordered source set; distance is the initial simple ordering;
2. calculate current mining capability for each source;
3. allocate the colony's shared hauling capacity across that ordered set;
4. derive mining and hauling fulfillment for every source from the same snapshot;
5. request the next useful miner, hauler, reserver, or other harvesting worker from that state.

For a newly reached source, request a miner immediately. Afterwards, compare mining and hauling fulfillment and reinforce the more limiting side. Prefer mining when the two are tied.

Haulers remain a colony-level shared pool. Their capacity is not permanently owned by the source whose deficit originally caused a hauler to spawn.

The ordered source snapshot must be independent of operation traversal order. No source may gain economic priority merely because its `plan()` or `execute()` happened to run first.

### 6. Keep economic policy out of SpawnAllocator

SpawnAllocator should arbitrate already-ranked generic requests.

It may compare generic priority fields lexicographically, but it should not understand:

- source distance;
- mining or hauling ratios;
- reservation mechanics;
- source productivity;
- remote economic policy.

The harvesting system decides what work is useful and assigns the corresponding request priority. SpawnAllocator only resolves contention between requests.

This preserves operation traversal independence: requests may be produced in any planning order and still receive the same final spawn ordering.

### 7. Treat reservation as a throughput unlock, not just another role in a fixed list

For a normal unreserved remote, full reservation changes source production from the unreserved baseline to the reserved throughput.

Use the fully reserved throughput as the denominator for hauling fulfillment.

For a newly developing normal remote:

1. spawn the miner immediately;
2. build hauling capacity;
3. once `haulRatio >= 0.5`, reservation becomes eligible;
4. after reservation is available, continue filling miner and hauler capacity toward the fully reserved target.

The 0.5 threshold has physical meaning: half of the fully reserved 10 energy/tick throughput corresponds to the unreserved 5 energy/tick source production. Before that point, reservation cannot be fully exploited by transport.

Reservation is a remote-room resource rather than a source-local resource, so one reserver may unlock multiple sources in the same remote. The harvesting system should evaluate that shared state when deciding whether reservation is useful.

Replacement timing for an established reservation should account for travel and remaining reservation time. Exact lead-time and tie-breaking rules are left to implementation.

### 8. Decouple infrastructure lifetime from workforce fluctuation

Remote workforce may fluctuate with spawn pressure. Established infrastructure should not follow the same fast frontier.

Use a persistent infrastructure state per source or route, conceptually including:

```ts
interface SourceInfrastructureState {
  readonly planRevision: number
  roadsEstablished: boolean
  nextMaintenanceTick: number
}
```

The exact representation may differ.

Road policy:

- before the route has been established, periodically request a road builder on roughly a 1,500-tick cadence;
- after the route has been established once, keep that fact persistently and request low-priority maintenance on roughly a 6,000-tick cadence;
- higher-priority spawn work may delay those maintenance visits;
- treat 1,500 and 6,000 as initial tuning values, not architectural constants;
- invalidate establishment when the underlying planned route or plan revision materially changes.

A maintenance creep should inspect the route while doing useful work, building missing roads and repairing damaged roads. Do not require a global pre-scan of every road hit value merely to decide whether maintenance is allowed to spawn.

Containers are more critical than roads and should be restored with higher priority when missing or unusable.

The purpose of this policy is to make roads a long-lived investment. A marginal remote may temporarily lose workforce without forcing its route to be abandoned and rebuilt.

## Reasons

### Explicit units are easier to reason about

The original `energyLevel` is piecewise:

- below the standard it behaves like a percentage;
- above the standard it behaves like surplus divided by 1,500 energy.

That made one scalar convenient for many historical consumers, but it hides the question each consumer is actually asking.

Explicit reserve and surplus values make control rules easier to verify, tune, and extend.

### Spawn time is itself a useful allocation mechanism

If upgrader, economy, construction, and other roles submit ordered useful work, spawn capacity does not need a separate optimizer to force every resource into an exact steady-state population.

Marginal remote workforce can disappear first when spawn pressure rises and return when pressure falls. This keeps the control surface small and makes the actual spawn bottleneck visible instead of predicting it indirectly.

### Shared hauling couples source decisions

A source's hauling fulfillment cannot be computed correctly in isolation when all sources share the same hauler pool. The same ordered snapshot should drive both spawn demand and runtime hauling decisions rather than relying on operation traversal order.

### Infrastructure has switching costs

Roads, containers, construction labor, and reservation state are investments. Frequent economic ON/OFF transitions can produce rebuilding and maintenance costs that a steady-state income calculation misses.

Keeping infrastructure on a slower lifecycle reduces this churn while still allowing workforce to respond to current spawn pressure.

### Reservation is nonlinear

Reservation is not merely another creep count. It changes source throughput. Delaying it until baseline hauling can use the unreserved 5 energy/tick avoids paying for throughput that the pipeline cannot yet transport, while still allowing it before the remote is fully built out.

## Consequences

- Economy code should prefer explicit energy and ratio fields over generic level thresholds.
- Existing v1 `energyLevel` and `empireEnergyLevel` thresholds are reference material, not APIs to reproduce.
- Harvesting needs a shared ordered state calculation across local and remote sources.
- Spawn and hauling behavior must not depend on operation traversal order.
- SpawnAllocator remains generic and consumes ranked requests rather than computing economic priorities.
- Source workforce and remote infrastructure should have separate state and timescales.
- Remote economic participation can be partial; a remote may remain admitted while its marginal workforce is temporarily underfilled.
- CPU and strategic remote gating remain separate from economic spawn contention.
- Telemetry should eventually expose at least source mining fulfillment, hauling fulfillment, reservation state, remote workforce frontier, room reserve/surplus, and upgrade/tick so that the heuristics can be validated in live play.
- The exact upgrader admission controller is intentionally still open and should be decided before implementing post-storage upgrader spawning.

## Alternatives considered

### Keep the original energy-level abstraction

Rejected for v2 as the core economic state. It is compact but combines reserve ratio and absolute surplus in one artificial scale, which makes policy harder to interpret and encourages unrelated systems to depend on the same thresholds.

### Let independent source operations consume shared hauling capacity in traversal order

Rejected. Traversal order is an implementation detail and does not represent economic priority. Shared hauling allocation must be computed from an explicit ordered source set.

### Put source economics inside SpawnAllocator

Rejected. The allocator should remain reusable arbitration infrastructure. Source distance, hauling fulfillment, reservation, and productivity belong to the harvesting policy that creates ranked requests.

### Explicitly optimize the number of active remotes

Deferred in favor of the spawn-driven frontier. The original bot already has sophisticated net-income/spawn-usage portfolio logic, but the rewrite should first test whether ordered useful work plus spawn contention reaches equal or better practical outcomes with less machinery.

A portfolio optimizer can be reintroduced later if live measurements show meaningful lost upgrade/tick.

### Repair roads only after scanning their current hits

Not selected as the first v2 design. It is more precise but adds repeated inspection work and tighter coupling between infrastructure state and visibility. Periodic maintenance is simpler and naturally degrades in priority when spawn time is scarce.
