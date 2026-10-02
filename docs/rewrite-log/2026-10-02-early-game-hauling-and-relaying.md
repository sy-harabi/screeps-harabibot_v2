# Early-game hauling and relaying

Date: 2026-10-02  
Related commits: `a5a92502`, `1395763c`, `8fcb540b`, `455003e9`, `8ae5f6c5`, `dc9b5f4a`, `4efa7521`

## Goal

Improve hauling while spawn time is the main economic constraint in the early game.

The policy uses small fixed-size haulers aggressively and reduces the cost of their long round trips by allowing energy to move through relay handoffs between opposing haulers. Speedrun mode uses this policy heavily, but the idea is more general than speedrunning: it is an early-game, spawn-time-bounded hauling policy.

This policy is separate from long-run remote infrastructure policy. Remote road and container construction, maintenance, payback, and later hauling profiles are optimized on a different timescale and are not part of this experiment.

## Starting point

The remote harvest system already had:

- one shared colony hauler pool;
- source assignment based on expected energy at arrival;
- separate empty and loaded travel estimates;
- explicit fetching, loading, and delivering behavior;
- colony logistics handling the final delivery inside the owned room.

For early progression, using small `CARRY/MOVE` haulers has useful properties:

- the body is cheap and becomes available at low energy capacity;
- an empty 1:1 hauler moves quickly on both plains and swamps;
- capacity can be added incrementally as spawn energy becomes available.

The downside is that the same throughput requires many creeps. On longer routes, those creeps repeatedly pass each other in opposite directions, so traffic and round-trip travel become increasingly important.

## Small-hauler policy

Speedrun mode keeps haulers on a fixed 1:1 profile and caps them at three `CARRY` and three `MOVE` parts.

Normal mode is allowed to choose different hauling profiles independently. In particular, the normal economy may later prefer larger or road-oriented creeps when that improves long-run spawn efficiency.

The early-game policy therefore does not define the permanent hauling architecture. It is a specialized response to a phase where spawn time is scarce and small bodies are useful.

## Relay idea

When a loaded delivering hauler and an empty fetching hauler approach each other on the same route, the loaded hauler can transfer its energy to the fetcher instead of both creeps continuing their complete round trips.

Conceptually:

```text
source                              colony

empty <- empty <- [meeting] -> loaded -> loaded
                      |
                   transfer
                      |
empty <- loaded <-          -> empty -> loaded
```

After the transfer:

- the old fetcher becomes the new deliverer;
- the old deliverer becomes the new fetcher;
- their source assignments are exchanged;
- movement-path progress is handed off or swapped;
- logistics supplier runtime follows the energy rather than remaining attached to the original creep.

The important object moving toward the colony is therefore the energy, not necessarily the same creep.

This lets a chain of small haulers behave more like a relay pipeline than a set of independent round trips.

## Hauling-capacity model

Without relay, required hauling capacity is approximately production multiplied by round-trip travel time.

Relay changes that relationship because adding another hauler to the chain shortens the effective trip that later haulers need to complete before an exchange becomes possible.

For a source producing `r` energy per tick, a one-way path of length `L`, and a fixed hauler capacity `C_h`, the implemented relay model uses:

```text
C_required
    = C_h * L * (sqrt(1 + 8r / C_h) - 1) / 2
```

where `C_required` is the target total carrying capacity.

The corresponding implementation is:

```ts
const haulerCapacity = SPEEDRUN_HAULER_MAX_CARRY * CARRY_CAPACITY

return (
  haulerCapacity *
  relayPathLength *
  (Math.sqrt(1 + (8 * energyPerTick) / haulerCapacity) - 1)
) / 2
```

Runtime source assignment uses the same idea in a simpler local form. If `n` haulers are already assigned to a source, the next hauler estimates its effective empty travel as:

```text
max(0, emptyTravelTicks - n)
```

and its effective cycle travel similarly.

This makes an established chain more attractive than treating every newly assigned hauler as if it must complete the original full route independently.

The model is an approximation of the realized relay pipeline, not a general transport law. It is intentionally scoped to this small-hauler policy.

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

Explicit states made it substantially easier to reason about same-tick handoffs than the earlier behavior inferred from several independent memory fields.

## Two-phase execution

Relay depends on movement intent, so hauler execution is split into two phases.

### Phase 1

`runHaulersPhase1` performs ordinary hauling work:

- prepare expected source energy;
- assign idle haulers;
- run fetching and loading;
- start loaded return trips;
- register eligible deliverers with colony logistics.

At this point movement intents exist, but colony logistics has not yet finished consuming suppliers.

### Colony logistics

The normal logistics system runs between the two hauler phases.

This allows a deliverer that reaches the colony to satisfy a spawn, extension, tower, upgrade, storage, or other logistics request using the same mechanism as the rest of the colony economy.

### Phase 2

`runHaulersPhase2` reacts to the results of Phase 1 and logistics:

1. finish deliveries that logistics emptied;
2. execute fallback storage/container/drop delivery;
3. immediately start the next fetch trip when a delivery finishes;
4. in speedrun mode, inspect movement intents and resolve coordination;
5. perform relay handoffs;
6. resolve pull chains involving traveling miners.

Keeping normal hauling and logistics behavior in Phase 1 and the post-intent coordination in Phase 2 avoids making the core logistics system aware of relay mechanics.

## Same-tick turnaround

A small-hauler pipeline loses meaningful throughput if an empty creep waits until the next tick before starting its next trip.

For that reason, a delivery that empties a hauler immediately:

- clears the previous source assignment;
- assigns the next useful source when possible;
- registers movement toward that source in the same tick.

The same rule applies whether the energy was consumed through normal logistics or through the fallback delivery path.

This behavior remains useful outside relay itself and is kept as normal hauler behavior.

## Delivery-side holding

Relay created one important edge case near the colony.

A fetcher can receive energy through relay while already standing in the exact position from which it can deliver to storage, a storage container, or the planned storage position. If it keeps the movement request it generated while still empty, it may leave that position before the new energy can be delivered on the next tick.

When a relay receiver is already at its delivery home and has no active logistics target, Phase 2 registers a move to its current position.

The hold is limited to cases where staying in place directly preserves the next delivery action. It is not a general traffic reservation mechanism.

## Movement-state handoff

Changing only creep memory is insufficient during a relay.

The two creeps may already have cached progress along the same known path, and the loaded creep may already be registered as a logistics supplier.

Relay therefore also transfers runtime state:

- mutual encounters swap known path indexes;
- one-sided encounters hand the supplier's known path index to the new deliverer;
- logistics supplier runtime is swapped so the delivery target follows the energy.

This keeps the new fetching and delivering roles aligned with movement and logistics state in the same tick.

## Pull chains

Small haulers can also block miners that are still traveling toward their sources.

During speedrun coordination, empty fetchers directly behind another empty fetcher or a traveling miner can form a pull chain. The front creep pulls its follower so the chain can continue moving instead of turning the miner-hauler interaction into a traffic deadlock.

This is a traffic optimization for dense small-creep early-game movement, not a general formation system.

## Other coordination fixes

Several smaller cases were handled as part of making the pipeline stable:

- a fetcher encountering an energy tombstone in its intended next tile may collect it and turn around immediately;
- source assignment counts are tracked during speedrun hauling so relay-aware travel estimates remain consistent within the tick;
- delivery fallback and logistics delivery both use the same immediate turnaround behavior;
- normal mode skips speedrun-only coordination state and work entirely.

## Scope

This experiment deliberately separates two economic policies.

Early-game spawn-time-bounded hauling:

- favors small incremental haulers;
- can use relay and pull-chain coordination;
- values rapid use of limited spawn time and low available energy;
- is used heavily by speedrun mode.

Long-run remote infrastructure and hauling:

- may build and maintain roads and containers;
- may use different body profiles;
- must account for construction and maintenance payback;
- is optimized for sustained economy rather than the early-game spawn-time bottleneck.

The two policies may share remote source paths and general harvest infrastructure, but they should not be treated as one optimization problem.

## Result

The speedrun hauling work is considered complete for now.

HarabiBot v2 now has an optional early-game small-hauler policy where opposing fetchers and deliverers can exchange energy and roles, with movement and logistics runtime handed off in the same tick. The implementation remains isolated behind speedrun-specific coordination so normal hauling can continue evolving toward long-run infrastructure and spawn-efficiency goals without inheriting the relay policy by default.
