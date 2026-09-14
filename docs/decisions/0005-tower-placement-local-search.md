# Tower placement by greedy seed and local pair search

Status: accepted
Date: 2026-09-14
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

The earlier design generated a compact central placement and a diameter-seeded distributed placement, then retained the better result. That was motivated by experiments showing a central regime for smaller perimeters and a distributed regime for larger perimeters.

Further exact-MILP comparisons showed that this classification is unnecessary for production. Once a completed six-tower placement is locally optimized by one- and two-tower replacement, the starting geometry matters much less than expected. A simple global max-min greedy seed is cheaper and at least as effective as the central/distributed construction.

## Decision

Production tower selection uses the following pipeline:

```text
global max-min greedy seed
        -> single-tower replacement to convergence
        -> full pair sweep
        -> full pair sweep
```

There is no central/distributed shape classification in production.

### 1. Candidate set and feasibility

Candidate generation keeps the existing v2 base-planner rules. Candidates are collected from buildable tiles adjacent to the finalized inside road network and must respect the current final defense and reserved tiles.

A candidate is rejected when it is outside the final inside topology, is wall terrain, is a road, is occupied, is reserved open space, or contains a room object. A dangerous tile is legal only when the finalized defense already placed an overlapping rampart there.

Tower placement may consume structure slots, including spawn-capable slots, but must preserve enough capacity for the remaining non-tower structures. Selection-dependent slot limits are checked at every greedy/replacement step.

These candidate and slot constraints are part of the optimization problem. Offline MILP comparison must use the same candidate set and aggregate slot limits.

### 2. Precompute candidate/rampart damage

Before selecting towers, precompute tower attack power for every candidate/rampart pair:

```text
damage[candidate][rampart]
```

The production implementation stores this as a flat `Uint16Array` and also caches each candidate's total rampart damage.

This avoids repeated range and falloff calculations inside single- and pair-replacement loops.

### 3. Global max-min greedy seed

Start with no towers selected. Until six towers are selected:

1. enumerate every currently legal unused candidate,
2. evaluate the partial placement produced by adding that candidate,
3. select the candidate with the best lexicographic placement score,
4. update slot usage and cached rampart totals.

This is a global greedy step: every rampart is evaluated for every candidate. It does not target only the previously weakest rampart.

The tie break for an otherwise equal candidate is lower `roomIndex`.

### 4. Single-tower replacement to convergence

After six towers exist, repeatedly sweep through the six tower positions.

For each position:

1. remove that tower,
2. keep the other five fixed,
3. search every legal candidate not occupied by those five,
4. choose the replacement that produces the best complete six-tower score,
5. replace the tower immediately if the score improves, or if the score is identical and the replacement has a lower deterministic room-index tie.

Later positions in the same sweep see improvements made by earlier positions.

Repeat sweeps until no tower changes. Production includes a defensive maximum of 20 single-replacement sweeps; the tested rooms converged well before that bound.

### 5. Two full pair sweeps

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

Run the entire 15-pair sweep exactly twice. Experiments showed a large improvement from the second sweep, while additional sweeps produced no meaningful minimum-DPS improvement in the tested sample.

Pair ties use the two candidate room indices in sorted order, preserving deterministic output independent of pair ordering.

## Why the earlier central/distributed branch was removed

Two observations changed the design.

First, local pair search is much stronger than expected. On the first 146 successful real-room plans, even a deliberately poor feasible six-tower seed was usually repaired by single/pair replacement. A simple global greedy seed performed better than the more complicated central/distributed initialization after the same refinement.

Second, the central beam search itself was not cheap. In local Node benchmarks, constructing the central beam seed cost on the order of the later local-search stages, while providing no final quality advantage once pair replacement was enabled.

The important optimization structure is therefore better described as a six-point max-min problem followed by one- and two-coordinate local search, not as a binary central-vs-distributed classification problem.

## Validation

All validation below used the exact same legal candidate set and aggregate slot/spawn-slot constraints as the heuristic, with a SciPy HiGHS MILP as the exact max-min reference.

Two disjoint samples of controller rooms were drawn from the embedded shardSeason map snapshot.

### Sample A

- 200 controller rooms sampled.
- 146 base plans succeeded and were eligible for tower comparison.
- `global greedy -> single convergence -> pair sweep x2` matched exact MILP minimum damage in `140 / 146` rooms (`95.9%`).
- The remaining 6 rooms were all exactly 30 DPS below optimum.
- Mean gap: `1.23 DPS`.
- Maximum gap: `30 DPS`.

### Sample B

A second set of 200 controller rooms was drawn with zero overlap with sample A.

- 155 base plans succeeded.
- Exact MILP match: `147 / 155` (`94.8%`).
- The remaining 8 rooms were all exactly 30 DPS below optimum.
- Mean gap: `1.55 DPS`.
- Maximum gap: `30 DPS`.

### Combined

Across the two disjoint successful-plan sets:

```text
287 / 301 exact = 95.3%
14 / 301 gap 30 DPS
0 / 301 gap > 30 DPS
mean gap = 1.40 DPS
```

This is materially stronger than the earlier central/distributed-plus-one-pass result, which matched exact minimum DPS in 46.6% of the first sample and had a maximum observed gap of 150 DPS.

### Diameter behavior

The earlier geometric transition near rampart diameter 25 still appears in the data, but it no longer needs to control the production algorithm.

With the final local-search pipeline:

- small perimeters are almost always exact,
- diameter 26 remains a transition region,
- larger perimeters are harder, but pair search removes nearly all of the previous large errors.

The geometry remains useful for understanding and benchmarking, not for selecting a production branch.

## Cost

Let:

- `n` = legal tower candidate count,
- `m` = final outer rampart count.

Damage-cache construction is `O(n * m)`.

Global greedy and single replacement are roughly linear in `n * m` per candidate sweep.

One full pair sweep examines 15 existing tower-position pairs. For each fixed four-tower set it considers roughly `C(n - 4, 2)` candidate pairs, giving the dominant term:

```text
O(15 * n^2 * m)
```

The pair stage is intentionally bounded to two sweeps rather than run to unconstrained convergence.

Local Node timings are useful only as relative development measurements, not as Screeps CPU claims. On the second 155-room comparison set, the complete heuristic averaged about 16.5 ms locally, with each full pair sweep averaging about 8 ms. Actual Screeps runtime CPU must be measured separately.

## Consequences

- Production logic becomes conceptually simpler: there is one optimization path instead of central and distributed branches.
- The optimizer is deterministic under a fixed candidate set.
- Pair search is the dominant planning cost, so future CPU work should optimize evaluation/pruning rather than reintroduce shape classification.
- Candidate/rampart damage caching is part of the production design, not an optional benchmark optimization.
- MILP remains a development oracle only and is not a runtime dependency.
- The planner still returns failure rather than weakening slot or construction constraints when six legal towers cannot be selected.

## Alternatives considered

- **Central beam + distributed fallback:** superseded. It helped before pair search, but final quality did not justify the extra branch and seed cost.
- **Diameter/shape classification:** useful for analysis, not required for the final search pipeline.
- **Candidate shortlist before pair search:** rejected. Even fairly large shortlists frequently removed complementary pairs where one tower supports one weak sector and the other supports another.
- **Weak-rampart grouping as the primary objective:** not needed. Rampart count is much smaller than the candidate-pair count; grouping may still be useful later as a safe pruning stage.
- **Only one pair sweep:** cheaper, but the second disjoint sample improved from 134/155 exact after one sweep to 147/155 after two, and reduced the maximum gap from 120 to 30 DPS.
- **Pair sweeps to full convergence:** unnecessary in current data; two sweeps reached the same minimum-DPS quality as further sweeps in the first benchmark.
- **Exact MILP in production:** retained only for offline validation because runtime dependency/CPU complexity is unnecessary for the observed heuristic quality.
