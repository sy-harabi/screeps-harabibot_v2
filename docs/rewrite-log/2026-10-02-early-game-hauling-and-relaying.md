# Early-game hauling and relaying

Date: 2026-10-02  
Related commits: `a5a92502`, `1395763c`, `8fcb540b`, `455003e9`, `8ae5f6c5`, `dc9b5f4a`, `4efa7521`

## Goal

Relay increases hauling throughput from the same number of creeps by handing energy between opposing haulers.

The strategy spends more CPU on additional creeps and coordination to reduce the spawn time required for a target throughput: effectively buying spawn time with CPU. This is useful in the early game, where CPU is relatively abundant but spawn time is scarce.

Relay is independent of whether roads are used. HarabiBot v2 currently uses it only in its roadless speedrun hauling policy because the speedrun ends too early for remote-road investment to pay back.

## Relay model

Consider:

- source production `R` energy/tick;
- one-way hauling distance `D`;
- `N` identical haulers;
- capacity `C` per hauler.

Without relay, each hauler completes a round trip of approximately `2D` ticks.

The ordinary hauling throughput is:

```text
P0 = NC / 2D
```

or, using total carrying capacity `Q = NC`:

```text
P0 = Q / 2D
```

Without relay, dividing the same total carrying capacity among more or fewer creeps does not change the modeled throughput. Only total carrying capacity matters.

Relay changes this.

When a loaded deliverer and an empty fetcher meet, they transfer energy and exchange roles:

```text
source                              colony

          loaded -> <- empty

                 transfer

          empty  <- -> loaded
```

The energy continues toward the colony on the new deliverer, while the previous deliverer immediately becomes a fetcher.

Treating the haulers as continuously and roughly uniformly distributed along the route, relay opportunity scales with hauler density:

```text
relay density ≈ N / D
```

A denser route creates proportionally more opportunities for loaded and empty haulers to hand their work off to each other.

Ordinary hauling contributes one unit of useful route progress. Relay adds another unit of effective progress when a handoff occurs, so the average hauling gain is approximated as:

```text
1 + N / D
```

This gives:

```text
P
  ≈ NC / 2D * (1 + N / D)
```

The approximation captures the behavior of an ideal relay pipeline:

- sparse haulers receive little relay benefit;
- increasing hauler density creates more handoffs;
- when `N` approaches `D`, throughput approaches roughly twice ordinary hauling throughput.

Actual throughput can be lower because of traffic, terrain, loading and delivery timing, and imperfect creep spacing.

## Required hauling capacity

To sustain a source producing `R` energy/tick:

```text
NC / 2D * (1 + N / D) = R
```

Multiply by `2D / C`:

```text
N(1 + N / D) = 2DR / C
```

Multiply by `D`:

```text
DN + N² = 2RD² / C
```

Therefore:

```text
N² + DN - 2RD² / C = 0
```

Taking the positive root:

```text
N
  = D / 2 * (sqrt(1 + 8R / C) - 1)
```

Since total carrying capacity is:

```text
Q = NC
```

the required carrying capacity is:

```text
Q_required
  = CD / 2 * (sqrt(1 + 8R / C) - 1)
```

This is the formula used by v2:

```ts
const haulerCapacity = SPEEDRUN_HAULER_MAX_CARRY * CARRY_CAPACITY

return (
  haulerCapacity *
  relayPathLength *
  (Math.sqrt(1 + (8 * energyPerTick) / haulerCapacity) - 1)
) / 2
```

## A discrete example

The continuous model can also be realized by a simple discrete steady-state schedule.

Take:

```text
D = 4
N = 4
C = 50
R = 50
```

The model predicts:

```text
P
  = 4 * 50 / 8 * (1 + 4 / 4)
  = 25 * 2
  = 50
```

Consider four positions from the colony to the source:

```text
Colony                          Source

 P1       P2       P3       P4
 A:L      B:E      C:L      D:E
```

`L` means loaded with 50 energy and `E` means empty.

During the tick:

1. `A` at `P1` delivers 50 energy and becomes empty.
2. `D` at `P4` loads 50 energy and becomes loaded.
3. `C` relays its 50 energy to `B`.
4. Each creep continues in the direction of its new role.

The next state is:

```text
 P1       P2       P3       P4
 B:L      A:E      D:L      C:E
```

On the next tick the same pattern repeats with the creep identities exchanged:

```text
 P1       P2       P3       P4
 A:L      B:E      C:L      D:E
```

The pipeline therefore repeats every two ticks while delivering 50 energy every tick.

Over four ticks:

```text
4 deliveries * 50 energy = 200 energy
```

so the steady-state throughput is:

```text
200 / 4 = 50 energy/tick
```

This shows that the `N = D`, `R = C` boundary of the continuous model is achievable in an ideal discrete relay schedule when traffic is ignored.

## What follows from the model

Without relay:

```text
P0 = Q / 2D
```

For fixed total carrying capacity `Q`, individual hauler size does not matter.

With relay:

```text
P
  ≈ Q / 2D * (1 + N / D)
```

and:

```text
N = Q / C
```

so:

```text
P
  ≈ Q / 2D * (1 + Q / CD)
```

Now individual hauler capacity `C` matters.

For the same total carrying capacity, smaller haulers mean more creeps. More creeps increase `N / D`, increasing relay throughput.

Relay therefore has two useful properties:

1. **More creeps can substitute for carrying capacity.**
2. **Smaller, uniform haulers make relay more effective.**

The cost is CPU and traffic.

More creeps require more creep execution, movement coordination, and collision handling. Relay therefore trades CPU and traffic complexity for lower required carrying capacity and lower spawn-time consumption.

This is useful in the early game because spawn time is scarce while CPU is comparatively available.

## Small uniform haulers

The relay benefit becomes stronger when the same carrying capacity is divided among more, smaller haulers.

Suppose the same total carrying capacity `Q` is implemented with either large or small creeps.

Without relay, both have the same modeled throughput:

```text
P0 = Q / 2D
```

With relay, smaller creeps create a larger `N`, increasing:

```text
1 + N / D
```

and therefore increasing throughput for the same total carrying capacity.

Uniform capacity also simplifies handoffs. A loaded hauler can transfer its load and role to an empty hauler without systematic capacity mismatch across the pipeline.

The ideal model therefore favors very small, uniform haulers.

Some top Screeps players use `1C1M` haulers for this kind of relay hauling.

HarabiBot v2 instead settled on at most:

```text
3 CARRY + 3 MOVE
```

per speedrun hauler.

`1C1M` and `2C2M` were theoretically more attractive because they create more creeps and therefore greater relay density for the same total carrying capacity.

In actual v2 speedrun testing, however, the additional creep count caused enough traffic congestion to erase the theoretical advantage.

`3C3M` was therefore a practical compromise:

- small enough to retain much of the relay benefit;
- cheap enough for incremental early-game spawning;
- large enough to reduce creep count and traffic pressure.

This does not mean `3C3M` is theoretically optimal. Better traffic handling can move the practical optimum toward smaller haulers.

## V2 implementation scope

Relay is independent of whether roads are used.

HarabiBot v2 currently enables relay only as part of its speedrun hauling policy, and that policy operates without remote roads.

This is a property of the current speedrun strategy rather than a requirement of relay.

Remote roads consume energy, WORK, spawn time, and time before they begin returning the investment. The current speedrun ends soon enough that this investment is not worthwhile.

Normal long-run remote mining follows a separate policy and can invest in roads, containers, different hauler profiles, and other infrastructure whose costs can be recovered over a longer operating lifetime.

Relay and remote infrastructure are therefore separate optimization branches.

## Runtime source assignment

The runtime assignment heuristic applies the same relay idea locally.

If `n` haulers are already assigned to a source, the next fetcher estimates its effective empty travel as:

```text
max(0, emptyTravelTicks - n)
```

and reduces its effective cycle travel similarly.

As the relay chain becomes denser, a newly assigned hauler is expected to meet another hauler sooner instead of completing the entire original route on its own.

## Hauler state machine

Hauler behavior was made explicit while implementing relay coordination.

```text
idle
  |
  | source assignment
  v
fetching
  |
  | source area reached
  v
loading
  |
  | energy acquired
  v
delivering
  |
  | delivery completed
  v
idle / immediately reassigned to fetching
```

A relay transforms two active trips directly:

```text
deliverer + fetcher
        |
        | transfer
        v
old deliverer -> fetching
old fetcher   -> delivering
```

The creep identities remain in place while the energy, source assignment, movement progress, and delivery responsibility continue in their useful directions.

## Two-phase execution

Relay depends on movement intent, so hauler execution is split into two phases.

### Phase 1

`runHaulersPhase1` performs ordinary hauling work:

- prepare expected source energy;
- assign idle haulers;
- run fetching and loading;
- start loaded return trips;
- register eligible deliverers with colony logistics.

### Colony logistics

The normal logistics system runs between the two hauler phases.

A deliverer reaching the colony can therefore satisfy normal colony energy requests before relay coordination is resolved.

### Phase 2

`runHaulersPhase2` reacts to the results of Phase 1 and logistics:

1. finish deliveries emptied by logistics;
2. execute fallback storage/container/drop delivery;
3. immediately start the next fetch trip after a completed delivery;
4. in speedrun mode, inspect movement intents;
5. resolve relay handoffs;
6. resolve pull chains involving traveling miners.

This keeps relay-specific coordination outside the normal colony logistics system.

## Same-tick turnaround

When a delivery empties a hauler, it immediately:

- clears the previous source assignment;
- finds the next useful source when possible;
- registers movement toward that source in the same tick.

Waiting another tick would directly reduce the throughput of a dense small-hauler pipeline.

The same behavior is used for normal logistics deliveries and fallback deliveries.

## Movement-state handoff

Changing creep memory alone is not enough when relay occurs.

The two creeps may already have cached progress along a known path, and the loaded creep may already own a logistics supplier target.

Relay therefore also transfers runtime state:

- mutual encounters swap known path indexes;
- one-sided encounters hand path progress to the new deliverer;
- logistics supplier runtime is swapped so the delivery target follows the energy.

The energy and the runtime state required to deliver it therefore continue together.

## Delivery-side holding

A relay receiver may already be standing next to storage, a storage container, or the planned storage position.

Before receiving energy it was a fetcher, so it may already have an outbound movement intent. If that movement remains active after the relay, the creep can leave the exact position from which it should deliver the newly received energy on the next tick.

When this occurs and there is no active logistics target, Phase 2 registers movement to the creep's current position.

## Pull chains

Dense small-hauler traffic also interacts with miners traveling toward their sources.

In speedrun mode, an empty fetcher directly behind another empty fetcher or a traveling miner may form a pull chain. The front creep pulls its follower so the chain can continue progressing instead of becoming a traffic blockage.

This is primarily a consequence of the high creep density created by the relay policy.

## Other coordination fixes

Several smaller cases were handled while stabilizing the pipeline:

- a fetcher encountering an energy tombstone in its intended next tile can collect it and turn around immediately;
- source assignment counts are tracked within the tick for relay-aware travel estimates;
- logistics and fallback deliveries share the same immediate turnaround behavior;
- normal mode skips relay-specific coordination state and work.

## Result

Relay gives early-game hauling another resource trade-off.

Instead of spending more spawn time on carrying capacity, the bot can use more small creeps and more CPU to create a denser relay pipeline. The higher density creates more handoffs, allowing the same total carrying capacity to produce greater throughput.

HarabiBot v2 uses this mainly as a roadless speedrun policy. Its `3C3M` haulers are a practical traffic compromise rather than the theoretical relay optimum.

Long-run remote infrastructure remains a separate optimization problem.
