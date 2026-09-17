# Tower placement by greedy seed and local pair search

Status: accepted
Date: 2026-09-14
Updated: 2026-09-15
Supersedes: [0004: Central-first tower placement with a greedy fallback](0004-tower-placement-central-first-greedy.md)

## Context

Tower placement is evaluated against the final outer rampart perimeter. The defensive objective is max-min: an attacker can choose the weakest point, so the planner should maximize the minimum combined tower attack power over all outer ramparts.

For a placement `S` of six towers and the final outer rampart set `R`:

```text
damage(S, r) = sum(towerDamage(range(t, r)) for t in S)
minimumDamage(S) = min(damage(S, r) for r in R)
```

Placement comparison is lexicographic:

1. higher `minimumDamage`,
2. fewer ramparts tied at that minimum,
3. higher total damage summed over all outer ramparts,
4. deterministic room-index tie break.

The earlier design generated a compact central placement and a diameter-seeded distributed placement, then retained the better result. Shape experiments showed why both regimes exist, but exact-MILP comparisons later showed that this classification is unnecessary for production once pair local search is available.

## Decision

Production tower selection uses the following pipeline:

```text
global max-min greedy seed
        -> full pair sweep
        -> full pair sweep
```

There is no central/distributed shape classification and no separate single-tower refinement stage in production.

### 1. Candidate set and feasibility

Candidate generation keeps the existing v2 base-planner rules. Candidates are collected from buildable tiles adjacent to the finalized inside road network and must respect the current final defense and reserved tiles.

A candidate is rejected when it is outside the final inside topology, is wall terrain, is a road, is occupied, is reserved open space, or contains a room object. A dangerous tile is legal only when the finalized defense already placed an overlapping rampart there.

Tower placement may consume structure slots, including spawn-capable slots, but must preserve enough capacity for the remaining non-tower structures. Selection-dependent slot limits are checked at every greedy and pair-replacement step.

These candidate and slot constraints are part of the optimization problem. Offline MILP comparison must use the same candidate set and aggregate slot limits.

### 2. Precompute candidate/rampart damage

Before selecting towers, precompute tower attack power for every candidate/rampart pair:

```text
damage[candidate][rampart]
```

The production implementation stores this as a flat `Uint16Array` and also caches each candidate's total rampart damage.

This avoids repeated range and falloff calculations inside the pair search.

### 3. Global max-min greedy seed

Start with no towers selected. Until six towers are selected:

1. enumerate every currently legal unused candidate,
2. evaluate the partial placement produced by adding that candidate,
3. select the candidate with the best lexicographic placement score,
4. update slot usage and cached rampart totals.

This is a global greedy step: every rampart is evaluated for every candidate. It does not target only the previously weakest rampart.

The tie break for an otherwise equal candidate is lower `roomIndex`.

### 4. Two full pair sweeps

A full pair sweep considers every pair of tower positions:

```text
C(6, 2) = 15
```

For each pair:

1. remove those two towers,
2. keep the other four fixed,
3. enumerate every legal pair of distinct candidate tiles,
4. choose the candidate pair producing the best complete six-tower score,
5. apply the replacement immediately.

The next tower pair is evaluated from the already-updated placement.

Run the entire 15-pair sweep exactly twice. The second sweep matters because a replacement made late in the first sweep can make a pair visited early in that sweep worth reconsidering.

Pair ties use the two candidate room indices in sorted order, preserving deterministic output independent of pair ordering.

## Why the earlier central/distributed branch was removed

Local pair search is much stronger than expected. Once completed placements can be repaired by replacing two tower positions at once, the starting geometry matters much less than it did under the original weak-rampart greedy algorithm.

A simple global greedy seed therefore gives a cheaper and cleaner starting point than maintaining separate central and distributed constructors.

The geometry research remains useful for understanding the problem. Small perimeters often favor compact central coverage, while long strips and some diamonds favor distribution because tower damage is bounded between 150 and 600. However, that distinction no longer needs to become a production branch.

## Why there is no single-tower refinement stage

A pair replacement neighborhood already includes single-tower moves whenever one of the two selected replacement positions stays unchanged.

A follow-up comparison on 400 evenly sampled controller rooms from the shardSeason snapshot produced 301 successful base plans and compared three refinements from the same global greedy seed:

| Refinement                         |    Exact MILP |     Mean gap | Max gap | Mean local time | Worst local time |
| ---------------------------------- | ------------: | -----------: | ------: | --------------: | ---------------: |
| pair sweep x2                      | **283 / 301** | **2.59 DPS** | 210 DPS |        14.72 ms |        100.01 ms |
| single convergence + pair sweep x2 |     282 / 301 |     2.69 DPS | 210 DPS |    **14.67 ms** |     **98.51 ms** |
| pair sweeps to convergence         |     284 / 301 |     2.49 DPS | 210 DPS |        17.30 ms |        197.86 ms |

The separate single stage provided no quality advantage and no meaningful runtime advantage. It was therefore removed.

Running pair sweeps to convergence gained only one additional exact result while increasing mean time and roughly doubling the observed worst case. Production keeps the bounded two-sweep version.

These timings are local JavaScript wall-clock measurements for relative development comparison, not Screeps CPU measurements.

## Validation history

Earlier experiments on two disjoint 200-controller-room samples used the intermediate pipeline `global greedy -> single convergence -> pair sweep x2`. Across the 301 successful plans in those samples, that pipeline reached the exact MILP minimum in 287 rooms and was at most 30 DPS below exact in the other 14.

Those historical numbers remain useful evidence that pair local search is strong, but they are not directly comparable to the later 301-room follow-up because the room samples differ.

The current decision to remove single refinement is based on the direct same-sample comparison above.

## Exact reference

MILP remains an offline development oracle only. It selects six legal candidates while maximizing the minimum tower damage over every outer rampart using the same aggregate slot constraints as production.

The exact solver can require seconds to complete, so it is not suitable as a runtime planner dependency. Its purpose is to measure heuristic quality and expose failure cases.

## Cost

Let:

- `n` = legal tower candidate count,
- `m` = final outer rampart count.

Damage-cache construction is `O(n * m)`.

One full pair sweep examines 15 existing tower-position pairs. For each fixed four-tower set it considers roughly `C(n - 4, 2)` candidate pairs, giving the dominant term:

```text
O(15 * n^2 * m)
```

The pair stage is intentionally bounded to two sweeps rather than run to convergence.

Future CPU work should focus on safe pair pruning, early rejection, or distributing planner work across the existing planning budget. Naive candidate shortlists were already tested and rejected because they frequently remove complementary candidate pairs.

## Consequences

- Production logic is one path: global greedy plus two pair sweeps.
- The optimizer is deterministic under a fixed candidate set.
- Pair search is the dominant planning cost.
- Candidate/rampart damage caching is part of the production design.
- MILP is only an offline validation tool.
- The planner still returns failure rather than weakening slot or construction constraints when six legal towers cannot be selected.

## Alternatives considered

- **Central beam + distributed fallback:** superseded. Useful during research, but unnecessary once pair local search is enabled.
- **Diameter/shape classification:** useful for analysis, not required for production.
- **Single-tower refinement before pair search:** removed. Same-sample benchmarking showed no quality or meaningful runtime advantage.
- **Candidate shortlist before pair search:** rejected. Good tower pairs are often complementary and are damaged by individual-candidate filtering.
- **Only one pair sweep:** rejected. Sequential replacements mean early pairs can become worth revisiting after later changes.
- **Pair sweeps to full convergence:** rejected for production. The measured quality gain was negligible compared with the larger worst-case runtime.
- **Exact MILP in production:** rejected. It is too expensive for runtime planning and unnecessary for the observed heuristic quality.
