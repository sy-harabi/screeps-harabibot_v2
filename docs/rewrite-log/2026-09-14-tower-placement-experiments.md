# Tower placement experiments: from greedy placement to pair local search

Date: 2026-09-14
Updated: 2026-09-15

## Goal

While building the v2 base planner, I wanted tower placement to optimize the actual defensive bottleneck instead of treating towers as arbitrary late-stage structures.

For a selected tower set `T` and final outer rampart set `R`, the objective is:

```text
maximize   min over r in R (sum over t in T towerDamage(range(t, r)))
```

An attacker can choose the weakest part of the perimeter, so average coverage is not the primary objective. The planner should maximize the least defended outer rampart.

When minimum damage ties, the experiments use two secondary criteria:

1. fewer ramparts tied at the minimum,
2. higher total tower damage summed over the whole perimeter.

A stable room-index tie makes the result deterministic.

## Starting point: weak-rampart greedy placement

The legacy bot and the first v2 implementation used a simple greedy rule:

1. start near the center,
2. find the currently weakest rampart,
3. place the next tower close to that rampart,
4. repeat until six towers exist.

This is cheap and often reasonable, but an early tower decision becomes effectively permanent. It can overreact to one weak location and miss layouts that require several towers to move together.

## Simple-shape experiments

I first tested synthetic perimeters: squares, long strips, and diamonds.

The main observation was a scale transition.

### Small bases

When the protected perimeter is small enough, a compact central cluster is strong. All ramparts remain in the useful part of the tower damage curve, so spreading towers gives little benefit.

### Large strips and diamonds

Once extreme ramparts become far enough apart, distribution can win. A tower near one end can deal maximum damage to that side while still contributing the long-range floor to the opposite side.

Tower attack damage is bounded between 150 and 600. That gives a useful intuition for a long strip: a tower specialized toward one end can contribute `600` there and still contribute at least `150` to the far end, giving a `750` two-end baseline. If a more centered placement leaves the relevant endpoint support below that level, moving outward can improve the bottleneck.

## Why diameter 25 appeared

For two ramparts separated by Chebyshev distance `L`, tower damage is linear between range 5 and 20.

A tower at range 5 from one endpoint has pair support:

```text
600 + damage(L - 5)
```

If `L <= 25`, then `L - 5 <= 20`, so both sides remain inside the linear/falloff region and moving along the geodesic mostly trades damage from one endpoint to the other without increasing their combined support.

Once `L > 25`, the far side reaches the 150-damage floor. Specializing a tower toward one endpoint can then increase total support. This explains the sharp transition that appeared around perimeter diameter 25-26 in strip experiments and later in real-room samples.

The diameter observation remained useful throughout the research, but it eventually became an explanation rather than a production branching rule.

## Exact reference: MILP

To evaluate heuristics reliably, I used a mixed-integer linear program over the exact legal tower candidates produced by the base planner.

Let `x_i` be 1 when candidate `i` is selected, `d(i, r)` its fixed damage to rampart `r`, and `z` the minimum defended damage.

```text
maximize z

subject to
    z <= sum_i d(i, r) * x_i     for every outer rampart r
    sum_i x_i = 6
    x_i in {0, 1}
```

The comparison also preserved the planner's aggregate structure-slot and spawn-slot limits. Therefore a heuristic gap means a placement-search gap, not a mismatch in candidate feasibility.

MILP is used only as an offline answer key. Exact solves can require seconds, which is far too expensive for the runtime planner.

## First major heuristic: centered vs distributed

The first strong approach explicitly constructed two different geometries.

- **Centered:** build a compact placement around the one-tower minimax center.
- **Distributed:** seed towers toward both endpoints of a rampart diameter and fill the remaining positions greedily.

Keeping the better complete result handled the central/distributed geometric split much better than the old single-path greedy algorithm.

A beam search around the central region and a diameter-seeded distributed branch were added to the browser experiment. A one-pass global one-tower refinement was then applied to both results.

At this point it looked as if production tower placement would need to detect which geometric regime a room belonged to.

## First 200-room benchmark

A deterministic 200-controller-room sample produced 146 successful base plans.

For the better of centered/distributed after the then-current one-pass refinement:

```text
exact MILP match:       68 / 146 = 46.6%
within 30 DPS:         103 / 146 = 70.5%
within 60 DPS:         130 / 146 = 89.0%
mean gap:               29.18 DPS
median gap:             30 DPS
maximum gap:           150 DPS
```

The diameter split was very clear:

| Final rampart diameter | n | Exact match | Mean gap |
| --- | ---: | ---: | ---: |
| `<= 25` | 73 | 68.5% | 14.0 DPS |
| `26` | 15 | 40.0% | 24.0 DPS |
| `>= 27` | 58 | 20.7% | 49.7 DPS |

Large-diameter rooms were still the hard cases.

The worst gaps included:

- `E13N64`: 150 DPS,
- `E46N8`: 120 DPS,
- `E5N43`: 120 DPS,
- `W1N64`: 120 DPS.

## The important failure mode: one-tower local minima

The four worst rooms suggested that initialization was not the main problem.

The current refinement moved one tower at a time. Some layouts required two towers to move together:

```text
move tower A only -> minimum gets worse -> reject
move tower B only -> minimum gets worse -> reject
move A and B together -> minimum improves substantially
```

That is a real two-coordinate local minimum.

A second issue was that the original refinement made only one sweep. Improvements made late in the sweep could make an earlier tower worth reconsidering, but the algorithm stopped before returning to it.

## Single replacement to convergence

The first fix was simple: keep doing one-tower replacement sweeps until no tower changes.

On the original 146 successful rooms, this alone changed exact-match count from 68 to 93 and reduced mean gap from about 29 DPS to about 15 DPS when applied to the previous heuristic paths.

This was useful as a research step because it confirmed that the one-pass stopping rule was unnecessarily weak.

## Full pair replacement

Next, I allowed two current tower positions to be reconsidered simultaneously.

For a complete six-tower placement:

1. choose two current tower positions to remove,
2. keep the other four towers fixed,
3. enumerate every legal pair of candidate tiles for the two open positions,
4. retain the pair giving the best complete max-min score,
5. continue through all `C(6, 2) = 15` existing tower pairs.

One pass through all 15 existing tower pairs is a **full pair sweep**.

The high-gap test rooms all reached the exact MILP minimum after repeated single replacement plus pair replacement. In particular, the 120-150 DPS outliers disappeared.

## Do we still need centered/distributed initialization?

Once pair search was available, I tested deliberately different starting placements.

On the original 146-room sample, after the then-current refinement pipeline:

| Initial placement | Exact matches | Mean final gap | Maximum final gap |
| --- | ---: | ---: | ---: |
| first feasible six by room index | 138 / 146 | 1.64 DPS | 30 DPS |
| old v2 seed | 136 / 146 | 2.26 DPS | 60 DPS |
| global max-min greedy | **140 / 146** | **1.23 DPS** | **30 DPS** |
| prior centered/distributed path | 137 / 146 | 1.85 DPS | 30 DPS |

Even a bad feasible seed was usually repaired. The simple global greedy seed was actually best among these tests.

This changed the interpretation of the problem. The important structure was no longer "classify this base as central or distributed." It was:

> greedily choose six reasonable towers, then repair the result with pair local search.

The centered/distributed experiments were useful for understanding the geometry, but the classifier itself turned out to be unnecessary.

## Candidate shortlist experiment

The obvious concern was pair-search CPU. With about 100 tower candidates, one full pair sweep can evaluate roughly tens of thousands of candidate pairs for each of the 15 existing tower pairs.

I tried restricting pair search to candidate shortlists chosen by support for weak ramparts.

This performed poorly. Even with relatively large shortlists, exact-match rate dropped sharply because good pairs are often complementary: one candidate covers one weak sector while the second covers another. Scoring candidates individually before pairing removes that complementarity.

The better simplification was not to shrink the candidate set, but to cap the number of full pair sweeps.

## Why exactly two pair sweeps

The second sweep matters because the 15 pair replacements are applied sequentially. A pair changed late in sweep 1 can make a pair visited early in sweep 1 worth revisiting. Sweep 2 captures that dependency.

The pair stage is therefore deliberately bounded rather than run to convergence.

## Independent second 200-room sample

To test whether the result was overfit to the original rooms, I drew another 200 controller rooms with zero overlap with the first sample.

Base planning succeeded in 155 rooms. Tower planning itself caused zero base-plan failures.

The intermediate research pipeline at that point was:

```text
global max-min greedy for all 6 towers
-> single replacement until convergence
-> full pair sweep
-> full pair sweep
```

against exact MILP:

| Stage | Exact matches | Mean gap | Maximum gap |
| --- | ---: | ---: | ---: |
| global greedy | 47 / 155 | 91.5 DPS | 840 DPS |
| + single convergence | 73 / 155 | 65.8 DPS | 810 DPS |
| + pair sweep 1 | 134 / 155 | 5.42 DPS | 120 DPS |
| + pair sweep 2 | **147 / 155** | **1.55 DPS** | **30 DPS** |

The final 8 non-exact rooms were all only 30 DPS below exact.

Diameter breakdown after pair sweep 2:

| Diameter | n | Exact |
| --- | ---: | ---: |
| `<= 25` | 100 | 99 / 100 |
| `26` | 14 | 12 / 14 |
| `>= 27` | 41 | 36 / 41 |

The small-base regime is still easier, but no diameter-specific production branch is needed.

## Combined validation of the intermediate pipeline

The two room sets were disjoint. Across all successful base plans:

```text
successful plans compared: 301
exact MILP matches:         287 = 95.3%
30-DPS gaps:                 14
>30-DPS gaps:                 0
mean gap:                  1.40 DPS
maximum gap:                 30 DPS
```

These results established that strong pair refinement made the complicated initialization unnecessary.

## Follow-up: removing single refinement

The pair neighborhood already contains single-tower moves when one of the two replacement positions is left unchanged. This raised the question of whether the separate single-refinement stage was doing useful work at all.

A follow-up benchmark used 400 evenly sampled controller rooms from the shardSeason snapshot. Base planning succeeded in 301 rooms. All three variants started from the same global greedy seed and used the same candidate set and MILP reference.

| Refinement | Exact MILP | Mean gap | Max gap | Mean local time | Median | P95 | Worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pair sweep x2 | **283 / 301** | **2.59 DPS** | 210 DPS | 14.72 ms | 12.19 ms | 37.20 ms | 100.01 ms |
| single convergence + pair sweep x2 | 282 / 301 | 2.69 DPS | 210 DPS | **14.67 ms** | **12.12 ms** | **37.13 ms** | **98.51 ms** |
| pair sweeps to convergence | 284 / 301 | 2.49 DPS | 210 DPS | 17.30 ms | 12.81 ms | 43.05 ms | 197.86 ms |

The separate single stage had no quality advantage and no meaningful runtime advantage. `pair sweep x2` was also much better bounded than running pair sweeps to convergence: convergence gained only one additional exact room while nearly doubling the observed worst-case local runtime.

The production pipeline was therefore simplified again to just greedy seeding plus two pair sweeps.

The new 301-room benchmark is a different room sample from the earlier two-sample validation, so `283 / 301` should not be compared directly with `287 / 301` as if it were a regression on the same rooms.

## Final production result

After all of the geometry and refinement experiments, the production algorithm is:

```text
6-tower global greedy
-> pair refinement sweep
-> pair refinement sweep
```

The geometric experiments were not wasted: they explained why the original greedy algorithm failed and exposed the importance of coordinated tower movement. But they were ultimately more useful for understanding the problem than for deciding the final production algorithm.

The final code does not classify a room as centered or distributed and does not run a separate single-tower refinement stage.

## CPU observations

The dominant cost is pair enumeration, not rampart count.

With `n` legal candidates and `m` outer ramparts, a full pair sweep is approximately:

```text
15 * C(n - 4, 2) * m
```

score contributions.

For the real samples, candidate count was commonly around 100 while rampart count was only a few dozen. Therefore reducing ramparts by clustering helps linearly, while reducing candidate pairs would help quadratically. Unfortunately, naive candidate shortlists damaged solution quality.

Damage values should therefore be cached first. For fixed four towers, pair evaluation becomes:

```text
baseDamage[r]
+ candidateDamage[a][r]
+ candidateDamage[b][r]
```

without recalculating ranges or falloff.

Local benchmark numbers are only relative development measurements, not Screeps CPU measurements.

Future CPU work should focus on safe pruning, early rejection, or scheduling the planner work across the existing planning budget rather than reintroducing central/distributed classification.

## Final production direction

```text
build legal candidate set
precompute candidate x rampart damage

selected = globalMaxMinGreedy(6)
selected = fullPairSweep(selected)
selected = fullPairSweep(selected)

return selected
```

The lexicographic objective is:

1. maximum minimum rampart damage,
2. minimum number of ramparts at that minimum,
3. maximum total rampart damage,
4. deterministic room-index tie.

There is no centered/distributed branch in the final production direction. The experiments remain in this log because they were the path that revealed the geometry and eventually showed that the simpler local-search formulation was enough.

## Blog narrative notes

A future article can preserve the useful discovery path without reproducing every intermediate optimizer variant:

1. Start from the original weak-rampart greedy algorithm.
2. Show why small squares make central clustering look obviously right.
3. Introduce the long-strip/diamond counterexample.
4. Explain the tower-damage floor and the diameter-25 transition.
5. Introduce MILP as an offline answer key and explain why it is too slow for production.
6. Show the central-vs-distributed heuristic and its improvement over the old greedy path.
7. Show the remaining 120-150 DPS outliers.
8. Explain one-tower local minima and why two towers sometimes have to move together.
9. Introduce full pair sweeps.
10. Reveal the final simplification: `6 greedy -> 2 pair sweeps`.

The article does not need to discuss the later single-vs-pair benchmark. That comparison was useful for simplifying production code, but it is not necessary to understand the main tower-placement story.
