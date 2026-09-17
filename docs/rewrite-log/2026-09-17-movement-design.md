# Movement design

Date: 2026-09-17

## Starting point

The current miner uses `moveTo()` directly. The original bot prepares paths synchronously and resolves traffic after role execution; some original callers use movement failure to select another action in the same tick.

## Decisions

The accepted design is recorded in [ADR 0008: Movement navigation and traffic](../decisions/0008-movement-navigation-and-traffic.md).

- Operations choose goals and policies; movement manages navigation; traffic assigns steps before a shared commit stage.
- Keep path preparation synchronous and resolve traffic after operation execution.
- A creep is fixed only when `holdPosition()` is called in the current tick. Otherwise, yielding is permitted within applicable constraints.
- Holds take precedence regardless of call order and must be renewed each tick. Arrival and absence of a movement request do not imply a hold.
- Keep the public status small and use observed positions to reconcile path progress.
- Movement owns disposable navigation state and registers long-lived caches through the runtime registry.
- Operations own durable goals and strategic risk policy; roles choose current actions and movement declarations within those decisions.
- Recovery invalidates only the scope supported by observed evidence. Local navigation failure does not establish a blocked room connection or strategic failure.

## Work completed

Added the design record and its decision-index entry. Production movement behavior has not changed.

Incorporated review feedback on caller responsibilities and recovery scope, and added a mineral/Source Keeper example that preserves risk restrictions during both repathing and traffic yielding. The first implementation slice remains unchanged.

## Verification

- Targeted Prettier checks passed for the new ADR, the decision index, and this log.
- Local Markdown links in those files resolved successfully.
- `git diff --check` reported no whitespace errors.
- Gameplay checks remain implementation expectations in ADR 0008; no production movement code was changed.

## Next step

Implement the first miner movement slice described in ADR 0008, including path reuse, current-tick traffic processing, and explicit holds at the working position.
