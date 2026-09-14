# Decision Records

Use this directory for decisions that materially affect architecture, ownership, interfaces, or dependencies. Use sequential filenames such as `0001-operation-centered-architecture.md`.

Do not create a record for routine implementation details. If a decision changes later, preserve the old record and mark it superseded rather than rewriting history.

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
