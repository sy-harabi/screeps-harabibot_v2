# Operation Foundation

Date: 2026-09-03  
Related commit: `95212e1`

## Goal

Establish the smallest operation-centered structure for the rewrite.

## Decisions

- Operations own persistent goals; capabilities provide reusable mechanisms.
- Operation state uses plain serializable records keyed directly in `Memory.operations`.
- Do not add a wrapper for hypothetical metadata; change the store if metadata becomes necessary.
- `EmpireOperation` is the root, and each owned room has one child `ColonyOperation`.
- The empire creates its colony records through the operation store.
- Preserve the original bot's specialized roles instead of inventing a bootstrap worker.
- Finish the base planner before rebuilding source management.

## Work completed

- Added empire and colony record types and factories.
- Added the `OperationRecord` union, Memory declaration, and operation store.
- The game loop now ensures the empire and owned-room colony records exist.
- Drafted initial base-plan and spawn-request contracts; these are not final yet.

## Result

The first operation hierarchy builds successfully and is ready for real colony systems.

## Next step

Define the complete base-planner requirements and architecture, then rebuild it as the first major subsystem.
