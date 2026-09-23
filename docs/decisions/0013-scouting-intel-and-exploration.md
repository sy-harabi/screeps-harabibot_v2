# Scouting purposes, intel, and initial exploration

Status: accepted; persistence and Explore implementation details partially superseded by [0014](0014-intel-persistence-bootstrap-and-explore.md)
Date: 2026-09-23

## Context

The original HarabiBot scouting code mixed several responsibilities: obtaining vision, refreshing room intel, choosing which rooms to revisit, finding resources, evaluating expansion, detecting enemies, and creating strategic missions. It also used a largely room-centric scouting cycle even though different information has very different value and freshness requirements.

The rewrite should preserve the useful MMO behavior while keeping world observation separate from the strategic systems that consume it.

The current implementation milestone is intentionally smaller than the full scouting design. It covers persistent room intel, initial exploration, and running scout creeps. Watching, resource scanning, observer allocation, and explicit on-demand vision will be added only when their consumers are implemented.

## Decision

### 1. Room intel is passive observed world state

Room intel belongs to the world/intel domain. Any live vision source may refresh it; the intel system does not care whether vision came from a scout, observer, remote worker, combat creep, or another source.

Initial room intel should include the facts needed by remote and expansion work, including:

- source IDs and positions;
- mineral ID, position, and type;
- controller position;
- controller owner and level when present;
- controller reservation when present;
- the tick at which the room was observed.

Static and dynamic fields may later gain different persistence or freshness policies, but the first implementation should keep the model small and readable.

Intel persistence belongs in segments, consistent with the storage decision in ADR 0006. Runtime caching may be used for hot decoded intel. A room observation must not be lost merely because its backing segment is not active on the current tick.

The intel refresher must not create missions, choose remotes, attack players, claim rooms, or otherwise turn observation into strategy.

### 2. Autonomous scouting has four conceptual purposes

The MMO scouting model is:

- **Explore**: obtain first vision and create intel for nearby unknown rooms.
- **Watch**: revisit nearby player-owned/reserved rooms and empty normal rooms to detect changes, estimate nearby activity, and discover new intruders.
- **Resource**: actively search for time-sensitive resources such as highway deposits and power banks, and refresh SK/center resource information when useful.
- **On-demand**: provide vision requested by another system, for example combat or claiming.

These are reasons to obtain vision, not separate creep ownership models.

For the current milestone only **Explore** is implemented. The other purposes are recorded so the first implementation does not create an abstraction that blocks them later.

### 3. Explore prioritizes rapid discovery of nearby remote candidates

Pure DFS is rejected because it may send a scout deeply in one direction while nearby remote candidates remain unknown.

Explore uses colony-relative room-graph depth. The search widens in horizons:

```text
depth <= 1
    -> depth <= 3
    -> depth <= 5
```

The horizon limits how far exploration may spread before nearer unknown territory has been covered. Within the currently allowed horizon, routing may choose targets that reduce travel rather than following strict BFS visit order.

Normal rooms are the primary Explore targets because nearby normal rooms are the important early remote candidates. Highway, keeper, and center rooms may still gain intel incidentally when the scout passes through them; active resource scanning of those room types belongs to the later Resource purpose.

The room graph is derived from actual exits through `getAdjacentRooms()`, not from linear room distance alone.

### 4. One exploration scout per colony initially

A colony with useful unexplored targets may maintain at most one exploration scout in the first implementation.

The scout:

- uses a minimal `[MOVE]` body;
- is owned by the spawning colony;
- may travel outside that colony's room;
- chooses subsequent exploration work from its current position rather than returning home between targets;
- contributes intel for every room that becomes visible while traveling;
- keeps working until no useful Explore target remains or it dies.

Individual unexplored rooms do not create individual spawn requests. Scout workforce is shared across the colony's exploration backlog.

The system may later allow extra scouts for Watch or Resource work when measured demand justifies them.

### 5. Future Watch policy

Watch is continuous but less urgent than initial exploration.

The intended starting policy is approximately:

- explicitly relevant hostile or other-player rooms: revisit around every 1,000 ticks;
- nearby empty normal rooms: revisit around every 5,000 ticks.

The purpose is change detection rather than continuously observing every known enemy room. Exact intervals may be tuned from live MMO behavior.

Explore and Watch should normally share the same base scout workforce instead of creating separate permanent scout roles.

### 6. Future Resource policy

Resource scouting is enabled when the empire actually wants the corresponding resource.

Highway deposits and power banks may justify frequent scanning over a small relevant set of highway rooms. Before observers are available, a dedicated scout circuit may be appropriate when the opportunity value justifies the spawn and travel cost.

Mineral type is effectively static after discovery. Mineral regeneration information should be refreshed according to its known cooldown rather than by blindly revisiting the room at a fixed short interval.

### 7. Future on-demand vision is an empire-wide capability

Combat, claiming, and other systems may later request vision explicitly.

That mechanism should be an empire-wide reusable capability rather than a strategic responsibility of the scouting policy. A caller should express that it needs a room visible; the vision mechanism may satisfy that need with existing vision, an observer, or an available scout.

Do not prebuild a persistent generic vision-request lifecycle. A per-tick request model is preferred for continuous needs: a combat system that needs continuous vision may request it each tick and simply stop requesting when the need ends.

Observers should be preferred when available and suitable. Scout creeps remain colony-owned even when used to satisfy empire-wide vision work.

## Initial implementation boundary

Implement now:

1. room intel model and segment-backed store;
2. refresh intel from every currently visible room;
3. colony-relative Explore target generation with the 1/3/5 room-graph horizons;
4. at most one `[MOVE]` scout per colony;
5. scout movement and continuous reassignment among Explore targets.

Defer:

- Watch scheduling;
- Resource scanning;
- observer allocation;
- empire-wide on-demand vision requests;
- expansion scoring and remote selection;
- strategic reactions to observed players.

## Reasons

- Remote mining needs nearby room facts early, so breadth near a new colony matters more than deep exploration.
- Keeping observation passive prevents the original scouting module from becoming a strategic god object again.
- A single scout can visit many rooms during one lifetime, so room count must not map directly to spawn count.
- The 1/3/5 horizon preserves breadth while allowing enough target freedom to avoid obviously wasteful strict-BFS travel.
- Deferring Watch, Resource, and on-demand vision avoids building a generic scheduler before their real consumers establish the necessary requirements.
- Colony ownership remains compatible with the current creep and spawn architecture without introducing a third ownership type.

## Consequences

- The main loop will need an intel-refresh step before consumers use room intel.
- The persistence layer needs segment IDs and a domain store for intel.
- Exploration needs a small room-graph search but no persistent target list.
- Scout execution can later accept higher-priority Watch, Resource, or on-demand work without changing the ownership model.
- Remote mining can consume RoomIntel after this milestone without depending on the scouting implementation itself.

## Alternatives considered

### Pure DFS exploration

Rejected because it can discover distant rooms while nearby remote candidates remain unseen.

### Strict BFS visit order

Rejected because forcing every room at one exact depth to be visited before allowing a nearby next-depth room can create unnecessary travel. The 1/3/5 horizon keeps breadth as the strategic objective while leaving routing some freedom.

### Persistent list of scouting targets

Rejected for the initial implementation. Explore targets are derivable from colony location, room topology, and RoomIntel. Persisting a second target model would duplicate state without providing a needed lifecycle.

### One scout spawn request per unknown room

Rejected. A scout is a shared worker that can satisfy many exploration targets during one lifetime.

### Put exploration, watching, resource scanning, combat vision, and strategic reactions in one scout manager

Rejected. These responsibilities have different owners and lifecycles. Scouting policy should decide what autonomous information gathering is useful; strategic systems remain responsible for what they do with that information.
