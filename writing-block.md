# HarabiBot Rewrite Context

## Purpose

This project is a rewrite of HarabiBot.

The goals are:

- improve the overall structure and maintainability of the bot,
- redesign systems that feel weak or difficult to extend,
- preserve useful ideas from the current bot instead of rewriting blindly,
- use the rewrite as a way to learn TypeScript and better software design.

The architecture described here is a **starting point, not a fixed specification**. It should change when implementation experience shows a better direction.

---

## Development Approach

The user will normally write the production code.

The agent should primarily act as:

- architecture advisor,
- planning partner,
- code reviewer,
- TypeScript mentor.

The agent should not implement substantial production code unless explicitly asked.

The user has more Screeps-specific knowledge than the agent. When a design decision depends on Screeps mechanics, strategy, economy, combat, or other game-specific assumptions, the agent should ask the user instead of inventing those assumptions.

---

# Core Philosophy

## 1. Prefer simple architecture

The rewrite should be cleaner than the current bot, but not more complicated merely for architectural purity.

Prefer:

- plain modules,
- plain functions,
- explicit data flow,
- small interfaces,
- clear ownership.

Avoid framework-like abstractions unless they solve a concrete problem.

Examples of things that should not be introduced without a clear need:

- complex schedulers,
- dependency injection systems,
- event buses,
- deep class hierarchies,
- elaborate generic frameworks.

CPU cost also matters. Architectural cleanliness should mostly come from good module boundaries and data ownership rather than expensive runtime abstractions.

---

## 2. Operations are the main coordination model

The bot will initially use an **operation-centered architecture**.

An operation represents a persistent responsibility, goal, or ongoing activity.

Examples:

- empire management,
- colony management,
- remote mining,
- room defense,
- expansion,
- siege,
- stronghold attack.

Operations may form a hierarchy.

Example:

```text
Empire
├── Colony W1N1
│   ├── Economy
│   ├── Defense
│   ├── Remote W2N1
│   └── Remote W2N2
│
├── Colony W5N3
│
└── War
    └── Siege W8N4
```

The hierarchy represents **decomposition of responsibilities and goals**.

A parent operation may:

- create child operations,
- configure their goals,
- observe their status,
- remove them when they are no longer required.

The exact hierarchy should remain flexible.

---

## 3. Not everything is an operation

Operations should represent goals or persistent coordination.

Reusable mechanisms should normally be separate capabilities.

Examples:

```text
operations/
    colony
    defense
    remote
    expansion
    siege

capabilities/
    spawning
    logistics
    combat
    movement
    resource allocation
```

An operation decides **what is needed**.

A capability provides **how something can be done**.

For example:

```text
DefenseOperation
    ↓
requests a defender
    ↓
spawn capability
    ↓
creates the creep
```

A remote operation should not need to understand the internal implementation of spawning.

---

## 4. Shared resources should be allocated explicitly

Operations often compete for resources that should not belong to one operation.

Examples include:

- spawn capacity,
- haulers,
- energy,
- terminal capacity,
- boost resources,
- possibly defenders or other reusable creeps.

Operations should generally express their needs through requests.

Example:

```text
Remote A ─┐
Remote B ─┼── haul requests ──> logistics
Remote C ─┘
```

The logistics system can then share haulers between remotes instead of each remote owning its own haulers.

Similarly:

```text
Any Operation
      ↓
SpawnRequest
      ↓
Spawn Allocator
      ↓
chosen colony
```

An operation should be able to request a creep without knowing beforehand which colony will spawn it.

---

## 5. Avoid hidden execution-order dependencies

The current bot has systems whose correctness depends on their call order.

Some ordering is legitimate and should remain explicit.

However, systems should not depend on arbitrary side effects from another manager having happened to run first.

A possible tick flow is:

```text
observe
→ plan
→ allocate
→ execute
→ finalize
```

This is a conceptual model, not necessarily a framework.

Operations may plan their needs first. Shared systems can then resolve requests and reservations before execution.

Not every operation needs every phase.

The goal is simply:

> real dependencies should be explicit; accidental ordering dependencies should be removed.

---

## 6. Keep the kernel minimal

The kernel is the small runtime layer responsible for running one Screeps tick.

It may eventually contain things such as:

```text
kernel/
    loop
    tick context
    CPU control
```

It should not contain Screeps strategy.

A general process scheduler is **not currently part of the baseline architecture**.

Start with straightforward execution and add scheduling machinery only if a real problem requires it.

---

## 7. CPU priority remains important

When CPU is limited, important work must still run first.

Combat, emergency defense, and other critical operations may need higher execution priority than background work.

The initial design can use a small number of priority classes such as:

```text
critical
normal
background
```

The exact CPU system should remain simple until more sophistication is proven necessary.

---

## 8. Separate persistent state from per-tick state

Persistent information belongs in Memory when it needs to survive ticks.

Temporary information should remain outside Memory when possible.

Examples of temporary state:

- requests,
- reservations,
- allocation results,
- derived calculations,
- per-tick caches.

This can be stored in a tick context or equivalent structure.

Memory should not become a universal communication mechanism between unrelated modules.

---

# Initial Architectural Shape

The exact folder structure is intentionally undecided, but the current conceptual model is approximately:

```text
src/
├── kernel/
├── operations/
├── capabilities/
├── world/
└── infrastructure/
```

### `kernel`

Minimal runtime coordination and CPU control.

### `operations`

Persistent goals and responsibilities, organized hierarchically where useful.

### `capabilities`

Reusable mechanisms such as spawning, logistics, combat, movement, and allocation.

### `world`

Information about the Screeps world: rooms, intel, map knowledge, and related queries.

### `infrastructure`

Persistence, logging, profiling, statistics, serialization, and similar technical concerns.

These names and boundaries are provisional.

---

# Design Principles

When designing a new system, prefer asking:

1. What responsibility does this system own?
2. Is it a persistent goal, a reusable capability, world information, or infrastructure?
3. What information does it need?
4. Who owns that information?
5. Does it actually need to know about the other module?
6. Is communication better represented as a request, result, or explicit dependency?
7. Does this abstraction solve a current problem, or merely make the architecture look cleaner?

Avoid creating generic utility modules that become dependency hubs such as:

```text
roomUtils
intelUtils
mapUtils
creepUtils
```

Reusable logic should normally live near the domain or capability that owns its meaning.

---

# Rewrite Strategy

Do not attempt to fully design the entire bot before implementation.

Instead:

```text
understand one system
→ define responsibilities
→ design a small interface
→ implement it
→ review it
→ learn from the result
→ adjust the architecture
```

The architecture should emerge gradually while maintaining consistent core principles.

Existing HarabiBot behavior should be treated as useful reference material, not automatically copied and not automatically discarded.

The rewrite should improve both the code structure and the systems that are currently considered weak.