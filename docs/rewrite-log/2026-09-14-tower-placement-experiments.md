# Tower placement experiments: from greedy placement to near-exact heuristics

Date: 2026-09-14

## Goal

While building the v2 base planner, I wanted to improve tower placement instead of treating tower slots as an arbitrary late-stage packing problem.

For defense, the important case is not the average tower damage over the perimeter. An attacker can choose where to attack, so the planner should assume that the weakest defended outer rampart is the one that matters.

For a selected tower set `T` and outer rampart set `R`, the objective is therefore:

```text
maximize   min over r in R (sum over t in T towerDamage(range(t, r)))
```

In other words: maximize the minimum tower damage on the outer rampart perimeter.

## Starting point: the old greedy approach

The legacy bot and the initial v2 planner used a simple greedy idea.

1. Pick a tower position that maximizes the current minimum damage over the rampart perimeter.
2. Find the rampart currently receiving the least total tower damage.
3. Place the next tower so that it supports that weak point.
4. Repeat until all towers are placed.

This is cheap and intuitive. It also tends to place the first tower near the geometric/defensive center, then reacts to weak parts of the perimeter one at a time.

The question was whether this local greedy behavior was actually close to the global optimum.

## First experiments: simple shapes

I started with deliberately simple synthetic bases to look for geometric rules before dealing with real Screeps terrain.

Test shapes included:

- small squares,
- large squares,
- long thin strips,
- diamond-shaped perimeters.

The results were more interesting than expected.

### Small shapes: clustered towers were strong

For sufficiently small perimeters, placing the towers close together near the center was consistently good. A compact tower cluster can keep every rampart inside the high-damage part of the tower falloff curve.

### Large squares: spreading out became better

As the square became larger, a compact central cluster stopped being optimal. Distributing towers over a wider area could raise the weakest perimeter damage.

### Long strips: the ends mattered

For a long thin base, I initially expected a central placement to remain attractive because the shape is effectively one-dimensional. Instead, placing towers toward both ends of the strip could be better.

### Diamonds: corner-oriented distribution could win

Large diamond-shaped perimeters showed a similar effect. Rather than keeping all towers around the center, distributing them toward the extreme points could improve the minimum damage.

### One common rule

Despite the different large-shape behavior, every tested family had the same small-scale regime: if the entire protected area was sufficiently small, a central tower cluster was better.

This suggested that the transition was not mainly about whether the shape was a square, strip, or diamond. The tower damage falloff itself was likely responsible.

## Why the transition happens

Screeps towers have a capped high-damage region at short range and a capped minimum damage at long range. Between them, damage falls with distance.

This creates a non-obvious effect on large bases.

Suppose two vulnerable ramparts are far apart. A tower placed in the middle may deal only medium damage to both. A tower placed near one end can instead deal maximum or near-maximum damage to one rampart while still contributing the minimum long-range damage to the other.

A representative comparison is:

```text
central-ish placement: 300 + 300 = 600
end-biased placement:   600 + 150 = 750
```

For example, on a sufficiently long span, a `15 / 15` distance split can be worse than a `5 / 25` split.

This explains why large strips and large diamonds can prefer separated tower groups. Once the perimeter is wider than the useful middle part of the tower falloff curve, balancing distance is not always equivalent to maximizing total support at the weakest point.

This was the main conceptual result from the simple-shape experiments:

> Tower placement has at least two geometric regimes: a compact central regime for sufficiently small bases, and a distributed regime once the perimeter becomes large enough relative to tower range and damage falloff.

## Building an exact reference with MILP

After finding these counter-intuitive examples, I wanted a reliable reference solution rather than judging heuristics by visual intuition.

Tower placement over a fixed set of legal candidate tiles can be written directly as a mixed-integer linear program.

Let:

- `x_i` be `1` if candidate tower tile `i` is selected,
- `d(i, r)` be the fixed tower damage from candidate `i` to rampart `r`,
- `z` be the minimum defended damage.

For six towers:

```text
maximize z

subject to
    z <= sum_i d(i, r) * x_i     for every outer rampart r
    sum_i x_i = 6
    x_i in {0, 1}
```

This produces the exact max-min solution over the supplied candidate tiles and therefore works well as an offline benchmark even if it is too expensive or inconvenient for normal in-game planning.

## Comparing v2 greedy placement with the exact optimum

I then compared the current v2 placement against the MILP optimum on real base-planner outputs.

The difference was sometimes negligible, but the bad cases were significant. The minimum defended damage could differ by as much as roughly `300` damage.

A recurring failure mode was especially important:

- the MILP optimum kept several towers concentrated near the center,
- the v2 greedy logic reacted to individual weak ramparts and spread towers too far toward the outside.

So the simple-shape experiments had revealed a real planner problem. The difficulty was that the correct answer was not simply "always central" or "always distributed".

## Failed attempt to derive a cheap exact rule

I tried several ways to turn the geometric observations into a cheap exact algorithm.

The obvious hope was to classify the perimeter by simple measurements such as size, diameter, aspect ratio, or rough shape, then choose a known placement pattern.

That did not generalize well enough.

Real base perimeters are irregular because of terrain, min-cut geometry, roads, reserved structure tiles, and legal tower positions. A real rampart boundary is rarely a clean square, diamond, or strip. Even when two bases have similar diameter, their best tower arrangements can differ.

I did not find a low-cost rule that reliably reproduced the exact MILP solution.

## Practical heuristic: centered vs distributed

Instead of trying to predict one universally correct pattern, I generated two deliberately different starting solutions and kept the better one.

### Centered candidate

The centered strategy starts from the single-tower max-min center: the legal tile whose tower damage has the highest minimum value over the outer ramparts.

It then builds a compact tower cluster around that center.

This explicitly represents the small-base / central-cluster regime and avoids the tendency of the original greedy algorithm to spread towers outward too early.

### Distributed candidate

The distributed strategy explicitly represents the opposite regime.

1. Find a pair of perimeter tiles `A` and `B` that realizes the rampart diameter.
2. Seed tower placement toward both extremes rather than beginning only from the center.
3. Continue placement using the same weak-rampart-oriented greedy logic.

The main purpose is to correct the original v2 behavior where the first tower naturally starts near the center even on shapes where the correct solution should commit early to both ends of the base.

### Select the better complete layout

Both layouts are evaluated using the real objective: minimum total tower damage over all outer ramparts.

The better result becomes the initial solution for the next stage.

This simple centered-vs-distributed competition handled the broad geometric split much better than trying to classify the base shape explicitly.

## Remaining gap: local improvement by moving one tower at a time

Centered vs distributed still left non-trivial errors. It was not unusual to see gaps of roughly `100-150` damage from the MILP optimum.

The next improvement was a small local search after all six towers had been placed.

Conceptually:

1. Hold five tower positions fixed.
2. Reconsider the remaining tower and greedily move it to the legal position that gives the best max-min score.
3. Repeat for each of the six towers.

This is effectively a coordinate-descent / one-tower-at-a-time local optimization. It is dramatically cheaper than searching all six-tower combinations, but it can repair mistakes made by the initial centered or distributed construction.

The important change is that the planner is no longer committed permanently to every early greedy decision.

## Final experiment result

The final heuristic was evaluated on `146` real map/base samples against the exact MILP reference.

Define the gap as:

```text
gap = exact MILP minimum damage - heuristic minimum damage
```

Results:

| Result | Share of samples |
| --- | ---: |
| Exact match | 46% |
| Within 60 damage of exact | 43% |
| Exact or within 60 | 89% |

Additional statistics:

- average gap: about `30` damage,
- maximum observed gap: about `150` damage.

Compared with the earlier cases where the simple greedy algorithm could be roughly `300` damage behind the optimum, this is a substantial improvement.

## What we learned

The main lesson is not a single geometric placement rule.

Tower placement behaves differently depending on the scale of the perimeter relative to the tower damage curve. Small bases favor a compact central cluster, while larger shapes can benefit from intentionally separated tower groups. However, real rampart geometry is irregular enough that shape classification alone is not robust.

The most effective practical approach so far is therefore:

```text
construct a strong centered solution
        vs
construct a strong distributed solution
        -> keep the better one
        -> locally re-optimize one tower at a time
```

This gives most of the quality of the exact MILP solution without requiring a global combinatorial search during normal base planning.

## Open questions

The remaining gap is small enough for practical use, but there are still useful research questions:

- Is there a cheap feature that predicts centered vs distributed before constructing both?
- Can the one-tower local search be repeated to convergence cheaply enough to remove more of the remaining `100-150`-damage outliers?
- Are the remaining failures mostly caused by local minima, candidate-slot constraints, or a missing third placement regime?
- Can perimeter-damage maps, local maxima, or diameter structure explain the remaining difficult cases?
- How much planner CPU does each stage consume in the actual Screeps runtime?

## Blog narrative notes

A useful future article structure is:

1. Start with the simple greedy algorithm and the max-min defensive objective.
2. Show small square results, where clustering in the center looks obviously correct.
3. Introduce a long strip or large diamond as the surprising counterexample.
4. Explain the counterexample through the tower damage curve using `300 + 300` versus `600 + 150`.
5. Introduce MILP as an offline "answer key" and show that the production greedy algorithm can really be hundreds of damage behind.
6. Show why simple shape classification fails on real min-cut perimeters.
7. Derive the centered-vs-distributed heuristic.
8. Add one-tower-at-a-time local optimization.
9. End with the `146`-sample benchmark: `46%` exact, `89%` within `60`, average gap `30`, maximum gap `150`.

This preserves both the engineering result and the reasoning path that led to it.
