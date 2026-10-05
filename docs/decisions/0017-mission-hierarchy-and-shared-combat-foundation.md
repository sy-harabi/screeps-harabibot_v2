# Mission hierarchy and shared Screeps combat foundation

Status: accepted
Date: 2026-10-06
Builds on: [0011](0011-colony-pipeline-and-mission-boundary.md)

## Context

ADR 0011 separated the ordered colony pipeline from persistent missions and deferred a concrete mission framework until the first real cross-room use case. Remote defense is that first use case.

The original bot used hierarchical mission composition successfully. A persistent force such as a Quad owns its own multi-tick lifecycle: production, preparation, assembly, travel, execution, reporting, and completion. It can therefore reasonably be a child mission of another mission. Future mission chains may have different depths.

The original bot also accumulated several separate implementations for creep strength, force comparison, remote-defense sizing, field behavior, and formation-specific evaluation. V2 should establish a small shared Screeps combat foundation before RemoteDefense so later missions can reuse the same physical model.

## Decision

### 1. Keep colony execution and missions separate

Routine colony work remains an explicit ordered pipeline. Missions are reserved for independent persistent goals with meaningful cross-tick state.

### 2. Missions form a recursive HTN-style tree

A mission may create child missions, and child missions may create their own children. There is no required hierarchy depth.

A parent normally understands only its immediate children. Mission composition follows the concrete problem rather than a fixed set of semantic levels.

### 3. Lifecycle ownership determines whether work is a mission

A task is a good mission candidate when it can independently own persistent state or resources and has a meaningful lifecycle with completion, failure, retry, or reporting.

A Quad may therefore remain a mission because it owns a sequence such as:

```text
produce
→ prepare
→ assemble
→ travel
→ execute
→ report
→ finish
```

Short-lived actions such as target selection, healing choice, one-step spacing, focus selection, or formation movement are shared capabilities, not missions.

### 4. Mission hierarchy is separate from creep ownership

Creep ownership remains canonical in `CreepMemory.assignment` and `TickContext.creepsByMission`.

Mission state may contain:

```ts
interface MissionBaseMemory {
  id: string
  type: string
  parentId?: string
  createdAt: number
}
```

The initial mission core only needs small helpers for create, lookup, child lookup, finish, and deletion. Do not add a generic planner, universal plan/execute contract, or abstract mission base class until concrete missions need one.

### 5. Shared Screeps combat code begins with a physical profile

The first reusable capability derives a physical profile from a creep body and boosts.

An initial shape may include:

```ts
interface CombatProfile {
  attack: number
  rangedAttack: number
  heal: number
  rangedHeal: number
  dismantle: number
  hits: number
  effectiveHits: number
  effectiveSustain: number
}
```

The exact shape may evolve.

The calculation is independent of mission type and opponent history. Live-creep and prospective-body calculations should share the same rules.

Boosted TOUGH should affect both burst durability and the value of healing while TOUGH is taking incoming pressure. The initial implementation may use a cheap heuristic rather than an exact multi-tick simulation, but burst durability and sustain must remain separate enough to avoid double counting.

### 6. Live perception stays outside persistent RoomIntel

Shared helpers should identify combat-capable creeps, group visible opponents, and aggregate profiles from live room state.

Transient creep bodies and positions should not be added to persistent RoomIntel merely for combat. A mission may persist the last-known threat information that its own lifecycle actually needs.

### 7. Engagement estimation returns measurements, not commands

The shared estimator should describe the expected engagement rather than return a command such as CHARGE, KITE, or RUN.

Useful outputs may include relative pressure, sustain, effective durability, estimated time to defeat either side, and an overall advantage value.

Each mission interprets those measurements according to its own goal and safety margin.

### 8. Position-dependent threat is shared

A shared helper should estimate potential incoming creep pressure at a position or produce a room-local matrix from visible opponents.

The first version only needs the ranges and boosted power of Screeps ATTACK and RANGED_ATTACK parts. Additional context should be added only when a real consumer needs it.

### 9. RemoteDefense is the first consumer

Before RemoteDefense, create only the clearly reusable foundation:

```text
src/capabilities/combat/
  combatProfile.ts
  combatPerception.ts
  combatEstimate.ts
  combatThreat.ts
```

RemoteDefense owns its own decisions about activation, required safety margin, reinforcement, withdrawal, abandonment, and completion.

Reusable combat-body construction and field-combat execution should be introduced while implementing RemoteDefense, once their concrete requirements are known.

### 10. Opponent experience is separate from creep physics

A later opponent model may learn that observed results systematically differ from the physical estimate for a particular player.

That correction belongs after the physical estimate, when deciding required force or acceptable risk. It does not modify `CombatProfile`.

The first RemoteDefense version may use a neutral correction and add learning only after real engagements provide useful result data.

### 11. Defer unsupported infrastructure

Do not prebuild a boost allocator, generic vision lifecycle, battle-history framework, opponent-learning formula, generic formation framework, or Quad/Blob implementation before a concrete mission requires it.

Existing spawn, movement, traffic, runtime-cache, and creep-assignment capabilities should be reused directly.

## Reasons

Recursive mission composition fits long-lived Screeps work that naturally decomposes into other independently managed lifecycles. It also allows future chains to become deeper or shallower without changing the framework.

Keeping mission knowledge local to immediate parent/child relationships prevents high-level missions from depending on preparation state, formation slots, or other descendant details.

Centralizing physical combat calculations prevents the several mission-specific strength formulas that accumulated in the original bot. Separating measurement from mission decisions keeps the same physical model reusable by RemoteDefense, Harass, Occupy, Assault, Quad, Blob, and future missions.

Using RemoteDefense as the first concrete consumer keeps the abstraction grounded in working code rather than recreating a speculative generic operation framework.

## Consequences

- The deferred mission system from ADR 0011 becomes a recursive parent/child mission tree.
- Mission depth is unrestricted and follows concrete lifecycle decomposition.
- Quad and Blob may remain child missions when their independent lifecycle justifies it.
- Mission hierarchy remains independent of canonical creep ownership.
- Shared combat capabilities stay below missions and do not depend on the mission using them.
- The physical combat profile is independent of mission-specific decisions and opponent history.
- Engagement estimation exposes measurements; missions choose how to respond.
- Transient visible-creep data stays outside RoomIntel by default.
- RemoteDefense is the first integration point for both the mission tree and shared combat foundation.
- More specialized combat infrastructure is added only when a concrete mission needs it.
