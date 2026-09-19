# HarabiBot Rewrite Context

HarabiBot v2 is a TypeScript redesign of HarabiBot, not a line-by-line port.

The original HarabiBot is already a strong bot in economy, combat, CPU management, and automation. However, it grew over a long period and accumulated substantial code and structural debt, especially mixed responsibilities and implicit dependencies through shared state and execution order.

The rewrite exists to preserve and build on the original bot's proven Screeps knowledge while creating a more professional, understandable, and maintainable codebase that can support an even stronger bot.

## Goals

HarabiBot v2 aims to surpass the original bot in all of the following areas:

- economy;
- combat;
- CPU management;
- automation;
- code quality;
- architecture.

Gameplay strength and efficient use of available resources are the primary outcomes. Code quality and architecture are important because they make those outcomes easier to achieve, improve, and maintain; they are not goals in isolation.

### Economy

Build a strong general-purpose economic foundation that can support both progression and later strategic spending such as warfare.

The binding resource changes as the empire grows:

1. while CPU has comfortable headroom, spawn time is the main scarce resource; use the available spawn time to maximize sustainable income and the controller progress (`upgrade/tick`) that economy can support;
2. once CPU becomes a meaningful constraint, use the available CPU budget to maximize sustainable income while preserving the strategic capabilities the empire needs.

Income is not the final objective by itself. In the early empire, much of it should be converted into GCL and RCL progress. Later, the same economic foundation must be able to redirect resources toward war, defense, expansion, reserves, power processing, and other strategic goals.

Optimize the economy as a whole rather than optimizing isolated creeps, rooms, or individual resource flows without regard to empire-level spawn time, CPU, and strategic output.

### CPU management

Use the available CPU budget to produce as much useful game outcome as possible.

Low CPU usage is not inherently better if unused CPU could support more economy, combat, analysis, or automation. Avoid waste, but optimize for total value produced under the CPU limit rather than for the smallest possible CPU number.

### Combat

Combat automation should operate across multiple levels of decision making:

1. select an appropriate opponent;
2. choose a strategy for that opponent, such as concentrated attacks, simultaneous multi-room pressure, remote harassment, or a combination;
3. choose suitable tactics and force types such as quads, blobs, squads, or duos;
4. use the results of those tactics as feedback and adapt until the campaign succeeds;
5. carry the strategic objective through to completion.

### Automation and competitive goals

In MMO, the bot should be capable of operating autonomously without manual intervention: expanding, running its economy, defending itself, selecting and executing offensive campaigns, adapting to their results, and continuing to grow its territory.

In Seasonal, the goal is top-tier competitive performance.

### Code quality and architecture

The codebase should be understandable, modifiable, and extensible enough that another developer can recognize it as well-engineered software.

Responsibilities, state ownership, and data flow should be clear where practical. Complexity is acceptable when it produces meaningful gameplay or performance benefits, but performance-driven complexity should be deliberate rather than accidental.

## Relationship to the original bot

The original HarabiBot is a reference, not a specification.

For each system, use the original implementation to understand proven Screeps strategy, practical edge cases, and optimization ideas. Preserve what remains valuable, improve what can be improved, and redesign the system when a better approach is available.

The rewrite should not inherit the original bot's code structure merely because that structure already exists.

## Optimization approach

Obvious waste in important hot paths should be avoided from the start. Foundational or performance-critical systems may be optimized aggressively when doing so improves the bot's real capabilities.

When an optimization adds substantial complexity, justify it with appropriate evidence such as theorycrafting, benchmarks, profiling, or live-game measurements. There is no fixed global rule that code simplicity must always beat performance, or vice versa; material trade-offs should be evaluated in context.
