# Remote harvesting and reservation lifecycle

Status: accepted
Date: 2026-09-26
Refines: [0009](0009-early-empire-economy-control.md)

## Context

Remote harvesting must extend the existing colony harvest system without recreating source-local operations or a separate remote scheduler.

The relevant constraints are:

- owned and remote sources share colony spawn time;
- haulers remain one shared colony pool;
- source order is the natural economic priority surface;
- reservation is room-level throughput shared by every source in a remote room;
- foreign reservation prevents harvesting and must be removed before the room becomes productive;
- harvest income is consumed directly by builder and upgrader policy, so remote and reserver costs must be represented in the same sustainable-income calculation;
- spawn requests should remain simple enough that harvest code itself visibly expresses gameplay priority.

An earlier remote-mining implementation was removed so the system can be rebuilt around these rules directly.

## Decision

### 1. Remote mining remains part of colony harvest

Remote mining is routine colony economy, not a mission and not an independent operation.

Remote room assignment, remote source paths, miners, shared haulers, reservers, and their sustainable income belong to the colony harvest domain.

### 2. Remote rooms own source paths; source data remains source-local

Source identity and intrinsic mining positions belong to source data. A remote room assignment owns the colony-relative paths used to reach its sources. Do not duplicate remote path ownership into generic source data.

Remote sources in one room are planned nearest-first:

1. Calculate an initial path to every source against the already-established colony remote network.
2. Sort by initial path length, with source ID as a deterministic tie-breaker.
3. Keep the nearest source's initial path.
4. Add that path to the provisional remote road network.
5. Recalculate each later source against the updated provisional network so it can reuse the earlier trunk.

Existing remotes from the same colony may contribute provisional road costs when planning a new remote. The remote currently being recalculated must not bias its own replacement path.

### 3. Harvest uses one ordered source list

Owned and remote sources are evaluated together in one source order:

1. owned sources before remote sources;
2. within each class, shorter source path first;
3. deterministic tie-breaking where needed.

The shared hauler pool is allocated across this same order.

This ordered traversal also defines harvest spawn priority: the first unsatisfied worker requirement encountered is the highest-priority harvest request for that tick.

### 4. Harvest submits at most one spawn request per tick

runHarvest traverses every source every tick so that shared hauling capacity, sustainable income, max income, spawn usage, and room-level reserver upkeep are still calculated for all sources.

The traversal must not stop after finding a spawn need. Instead it keeps a tick-local flag such as:

~~~ts
let spawnRequested = false
~~~

After the first successful harvest spawn request, later sources continue economy calculation but skip spawn-decision logic.

### 5. Remote room-level logic runs on the first visit in source order

runHarvest keeps a tick-local set:

~~~ts
const checkedRemotes = new Set<string>()
~~~

The first source encountered for a remote performs that room's reservation logic. Later sources from the same room do not repeat it.

This avoids coupling room-level policy to a particular element of RemoteRoomData.sources while naturally giving the room-level decision the priority of its nearest source.

### 6. Reservation state is explicit

A remote controller is classified as:

~~~ts
type ReservationState = "none" | "ours" | "foreign"
~~~

The harvesting interpretation is:

~~~text
none    -> harvestable at 5 energy/tick
ours    -> harvestable at 10 energy/tick
foreign -> not harvestable; sustainable source income is 0
~~~

A foreign reservation must not consume shared hauling capacity and must not create miner or hauler spawn requests.

Existing miners should not attempt to harvest while the room is foreign-reserved. Existing haulers may still recover energy that already exists.

Foreign reservation does not remove the remote assignment. It creates reserver demand so the reservation can be attacked and removed.

### 7. Remote miner size depends on reserver capability, not current reservation state

Remote miner target WORK is:

~~~text
colony energy capacity < 650  -> 3 WORK
colony energy capacity >= 650 -> 5 WORK
~~~

The source's actual required harvest power remains separate:

~~~text
none -> 5 energy/tick
ours -> 10 energy/tick
~~~

This prepares the miner for reserved throughput as soon as the colony can spawn a CLAIM + MOVE reserver.

### 8. Sustainable reservation power target is 2

Remote reservation targets total effective CLAIM power 2.

Reserver bodies are:

~~~text
energy capacity < 650     -> unavailable
650 <= capacity < 1300    -> [CLAIM, MOVE]
energy capacity >= 1300   -> [CLAIM, CLAIM, MOVE, MOVE]
~~~

At 650-1299 capacity, two one-CLAIM reservers are therefore maintained over multiple ticks. At 1300 or above, one creep can provide the full target.

Controller-adjacent walkable position count may be cached for diagnostics and future policy, but a one-position controller does not prevent requesting two one-CLAIM reservers.

### 9. Reserver demand uses one replacement condition

For each remote, calculate lead time from the body currently spawnable by the colony:

~~~text
leadTime = spawn time + controller travel ticks + 20
~~~

Count only reserver power expected to survive at least that long:

~~~text
reservePower = sum(active CLAIM parts of reservers whose TTL >= leadTime)
~~~

A spawning reserver is treated as alive for this accounting so repeated ticks do not request duplicate power unnecessarily.

For our reservation:

~~~text
reservationTicks = reservation end tick - Game.time
~~~

For no reservation or a foreign reservation:

~~~text
reservationTicks = 0
~~~

A reserver is needed when:

~~~text
reservePower < 2
&& reservationTicks - leadTime < 200
~~~

There is no separate restart and replacement policy. The 20-tick term protects replacement timing; the 200-tick margin starts replacement comfortably before our reservation becomes fragile.

### 10. Initial reservation waits for baseline remote throughput

For an unreserved remote, reservation is not started until the first source encountered for that room is already sustainable at neutral 5 energy/tick throughput: both mining and hauling fulfillment are complete.

The progression is:

~~~text
nearest remote source miner
-> nearest remote source hauling at 5 energy/tick
-> reserver
-> reserved throughput
-> further miner/hauler expansion
~~~

A foreign reservation is different: harvesting is impossible, so reserver demand is checked immediately rather than waiting for miner or hauler readiness.

### 11. Spawn order is expressed directly by the single source traversal

Within the ordered source traversal:

~~~text
owned source:
  miner / hauler

remote + foreign reservation:
  reserver

remote + no reservation:
  miner / hauler at 5 energy/tick
  -> reserver when the first source is ready

remote + our reservation:
  reserver maintenance
  -> miner / hauler at 10 energy/tick
~~~

Miner and hauler reinforcement continues to use fulfillment ratios. Reinforce the more limiting side and prefer mining on ties.

Once one request is submitted, later sources still contribute to economy calculations but cannot submit another harvest request that tick.

### 12. Controller travel time is a disposable harvest runtime cache

The full path to a remote controller is not persisted.

Harvest runtime caches derived controller information per remote room:

~~~ts
interface RemoteControllerRuntime {
  readonly travelTicks: number
  readonly availablePositions: number
}
~~~

Controller travel is calculated from colony storage to controller range 1 using:

~~~text
plainCost = 1
swampCost = 5
~~~

Only PathFinder.search(...).cost is retained. Allowed rooms are derived from the remote's existing source paths rather than introducing another persistent route representation.

availablePositions is the number of non-wall terrain tiles adjacent to the controller.

Remote assignment or route changes invalidate the colony harvest runtime, which also invalidates this derived controller cache.

### 13. Reserver actions are simple

A reserver travels to controller range 1.

At the controller:

~~~text
foreign reservation -> attackController()
otherwise            -> reserveController()
~~~

After a foreign reservation disappears, a surviving reserver naturally begins reserving without a separate state transition.

Creep memory stores the target remote room. Reservation remains room-level rather than source-level state.

### 14. Reserver upkeep is a room-level sustainable economy cost

Reserver cost is not assigned to an individual source because one room-level reservation unlocks all sources in that room.

For reservation power 2, long-run reserver energy cost converges to:

~~~text
650 / (CREEP_CLAIM_LIFE_TIME - controllerTravelTicks)
~~~

energy per tick.

The derivation is the same whether power 2 comes from two CLAIM + MOVE creeps or one 2 CLAIM + 2 MOVE creep. With reserve power 2, reservation grows by one net tick per active tick after natural decay, so each productive reserver interval creates approximately one equally long idle reservation interval.

The corresponding long-run spawn usage is:

~~~text
2 * CREEP_SPAWN_TIME
---------------------
CREEP_CLAIM_LIFE_TIME - controllerTravelTicks
~~~

spawn ticks per game tick.

This room-level cost is counted once when the reservation lifecycle is active, not once per source.

A reservation lifecycle is active when the room is ours-reserved, foreign-reserved and being contested, already has a reserver, or an unreserved room has reached neutral-throughput readiness and reservation is being initiated.

### 15. Source and reservation economy remain separate

SourceEconomy continues to describe source-local economics:

~~~text
source production
- miner upkeep
- hauler upkeep
~~~

Reservation upkeep is applied once per remote room by harvest orchestration.

Foreign-reserved sources contribute zero source income and zero source spawn usage because they are not currently harvestable.

HarvestResult.income remains a sustainable net-income estimate and therefore includes both source-local worker upkeep and room-level reserver upkeep before it is passed to builders and upgraders.

## Reasons

### One traversal makes priority visible

The source traversal already defines economic ordering and shared-hauler allocation. Reusing the same order for spawn decisions removes a second priority model.

### One request per tick is sufficient

Harvest demand is recomputed every tick. Lower-priority needs can be requested on later ticks rather than queued in parallel.

### Reservation is room-level state

A reservation affects every source in the room and must therefore be evaluated and costed once per remote.

### Foreign reservation is qualitatively different from no reservation

A neutral source remains harvestable at reduced throughput. A foreign-reserved source is not harvestable by this colony at all.

### Derived controller data does not need persistence

Controller travel time and adjacent terrain availability are cheap enough to compute once per harvest-runtime lifetime and invalidate naturally when remote assignments change.

## Consequences

- runHarvest becomes the canonical place to read harvest spawn policy.
- Harvest produces at most one spawn request per colony per tick.
- The source loop always finishes even after a spawn request because economy accounting and shared-hauler allocation still need later sources.
- Remote room reservation logic executes only on the first visit to that room in source order.
- Foreign reservation produces zero harvest income until a reserver removes it.
- Remote miner body sizing and actual source throughput are intentionally separate concepts.
- At capacity below 1300, two one-CLAIM reservers may coexist to provide target power 2.
- Controller slot count is recorded but does not gate reserver spawning.
- Reserver upkeep is visible in sustainable income and spawn-usage accounting.
- SpawnAllocator remains unaware of source distance, fulfillment ratios, reservation state, or remote economics.

## Alternatives considered

### A separate remote or reserver planning pass

Rejected for the first implementation. It creates another priority surface and makes it easier for reservation demand to disagree with source ordering.

### Stop the source loop after the first spawn request

Rejected. Later sources still need hauling allocation and economy accounting in the same tick.

### Attach reservation responsibility to a fixed first source field

Not required. A tick-local checkedRemotes set directly expresses the intention to run room-level logic the first time the ordered traversal reaches a remote.

### Require two controller-adjacent positions for two one-CLAIM reservers

Rejected. Reservation power remains the spawn-policy target even when only one adjacent tile is available.

### Store a persistent controller path

Rejected. Only travel cost is currently needed for replacement and economy calculations.

### Treat foreign reservation as neutral five-energy throughput

Rejected. A source reserved by another player is not harvestable by this colony, so sustainable income is zero until the reservation is removed.
