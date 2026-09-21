# Decision Records

This directory contains design-session notes and handoff snapshots from past theorycrafting work.

These records capture the reasoning, assumptions, alternatives, and tentative conclusions that were useful at the time they were written. They are **not specifications** and are **not guaranteed to describe the current implementation or current design intent**.

Do not treat a record as authoritative merely because its status says `accepted`. Before relying on a decision record:

- inspect the current code;
- consider the current conversation and user instructions;
- verify that the assumptions and constraints in the record still apply.

Agents should not read this directory by default. Consult a record when the current task is directly related to that design history, when the user points to it, or when previous reasoning would materially help avoid repeating the same theorycrafting work.

Use this directory when a design discussion becomes long enough that preserving its reasoning will help a later session continue the work. Routine implementation details do not need a record.

Prefer preserving the historical context of an existing record rather than rewriting it to match current code. If a later session materially changes the earlier conclusion, add a new record or an explicit follow-up/superseding note when that history is useful.

Suggested structure:

```markdown
# Decision title

Status: proposed | accepted | superseded
Date: YYYY-MM-DD

## Context

## Decision

## Reasons

## Consequences

## Alternatives considered
```

## Records

- [0001: Base planner core layout](0001-base-planner-core-layout.md)
- [0002: Extension layout packing](0002-extension-layout-packing.md)
- [0003: Dynamic lab placement](0003-dynamic-lab-placement.md)
- [0004: Central-first tower placement with a greedy fallback](0004-tower-placement-central-first-greedy.md) — superseded by 0005
- [0005: Tower placement by greedy seed and local pair search](0005-tower-placement-local-search.md)
- [0006: Storage, persistence, and bot options](0006-storage-persistence-and-bot-options.md)
- [0007: Runtime cache ownership and registry](0007-runtime-cache-ownership-and-registry.md)
- [0008: Movement navigation and traffic](0008-movement-navigation-and-traffic.md)
- [0009: Early-empire economy control and spawn-driven remote frontier](0009-early-empire-economy-control.md)
- [0010: Harvest operation boundary](0010-harvest-operation-boundary.md) — superseded by 0011
- [0011: Colony pipeline and mission boundary](0011-colony-pipeline-and-mission-boundary.md)
