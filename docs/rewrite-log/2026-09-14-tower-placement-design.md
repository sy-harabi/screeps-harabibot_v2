# Central-first tower placement design

Date: 2026-09-14
Related commits: none; documentation-only working-tree change

## Goal

Record a tower-placement procedure suitable for low-cost Screeps planning without combination search or substantial optimization machinery.

## Starting point

The tower-placement discussion explored central versus dispersed layouts using an external HTML planner experiment. That experiment includes LP and tower exchanges; it is not the selected production algorithm. The repository's rewrite context remains authoritative: production planning targets the Screeps runtime.

## Decision and work completed

Added [decision 0004](../decisions/0004-tower-placement-central-first-greedy.md): try a compact central placement, certify its minimum attack power with a weak-rampart support upper bound, and use a fresh six-step greedy fallback only when not certified. Retain the better complete feasible result.

Recorded the inclusive outside-range-3 exclusion, construction constraints, certificate proof, integer-grid bound, greedy comparison rule, complexity, and validation requirements. Certification failure is explicitly inconclusive; it is not evidence that central placement is inferior.

## Evidence and limitations

This is an accepted design direction, not a production implementation or a measured CPU/quality claim. No production source was changed. The referenced legacy path `C:\projects\screeps\HarabiBot_3.0` was unavailable during documentation, so this record does not attribute behavior to that legacy implementation.

The mathematical certificate follows from minimum <= subset average <= the best six candidate support sum. The greedy fallback has no claimed general approximation guarantee. Earlier HTML LP-plus-swaps measurements are not evidence for this simpler procedure.

## Next step

Implement the small procedure when requested, settle the compact-neighborhood rule, and validate quality and actual Screeps CPU with the same candidate/feasibility model used by the reference optimizer.
