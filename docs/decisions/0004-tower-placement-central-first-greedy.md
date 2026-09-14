# Central-first tower placement with a diameter-seeded greedy fallback

Status: accepted (design direction; production implementation pending)
Date: 2026-09-14

## Context

Tower placement should produce a strong six-tower defense with a small, predictable planning cost and little algorithmic machinery. The primary objective is the lowest combined tower attack power over the final outer ramparts.

Experiments suggested that narrow strips often favor dispersed towers, approximately square perimeters often favor concentration, and diamond-shaped perimeters can favor dispersion sooner. These are observations, not sufficient classification rules. Terrain, safe construction candidates, and the attack falloff plateaus change the outcome.

A plain greedy construction starting from zero tends to place its first tower near the one-tower minimax center, so it can reproduce much of the same central bias as the compact central attempt. The fallback should instead deliberately seed both extreme sides of the perimeter, then let greedy choose the remaining towers.

The agreed production direction is:

```text
try a compact central placement
    -> certify its minimum attack power when possible
    -> if not certified, find a diameter pair of outer ramparts A and B
    -> choose one tower candidate near A and one near B
    -> greedily place the remaining four towers
    -> keep the better complete feasible placement between central and distributed greedy
```

A failed certificate means **unknown**, not **central placement is inferior**. The distributed greedy result must still be compared against the central result.

This record defines the intended algorithm, not current implemented bot behavior. The separate HTML experiment used LP and tower exchanges; its results do not establish the CPU cost or quality of the simpler algorithm selected here. Production interfaces and visualization remain focused on the Screeps runtime, as required by [the rewrite context](../rewrite-context.md).

## Model and candidate constraints

Let `R` be the nonempty set of final outer rampart tiles and `C` the set of potential tower construction tiles. Use Screeps range:

```text
distance(a, b) = max(abs(a.x - b.x), abs(a.y - b.y))

attack(distance) = 600                       if distance <= 5
                   750 - 30 * distance       if 5 < distance < 20
                   150                       if distance >= 20
```

For a placement `S` of six distinct candidates:

```text
damage(S, rampart) = sum(attack(distance(tower, rampart)) for tower in S)
minimumDamage(S)   = min(damage(S, rampart) for rampart in R)
```

This evaluates attack power at rampart coordinates as a planning proxy. It does not simulate enemy positions, healing, boosts, energy availability, or simultaneous target allocation. Certificates apply to this stated model, not to every combat situation.

Exclude a candidate if it is within range 3, inclusive, of any outside tile in the final defensive topology. An existing or planned rampart on that candidate does not waive this exclusion. Use range, not path distance.

Actual placements must also respect walls, objects, occupied/reserved tiles, road service requirements, and remaining structure/spawn slot capacity. Check selection-dependent constraints as towers are chosen. Do not return a partial placement when fewer than six feasible towers can be selected.

For certification, `C` must contain every location that a legal competing placement could use under the same planning assumptions. It may conservatively include extra locations or ignore joint slot constraints: that only weakens the upper bound. Arbitrarily restricting it to nearby or preferred locations invalidates a claim of global optimality.

## Decision

### 1. Construct a compact central placement

For each safe candidate, calculate its maximum distance to an outer rampart:

```text
maximumRange(candidate) = max(distance(candidate, rampart) for rampart in R)
```

If the rampart coordinate extrema are `minimumX`, `maximumX`, `minimumY`, and `maximumY`, the same value is:

```text
max(candidate.x - minimumX,
    maximumX - candidate.x,
    candidate.y - minimumY,
    maximumY - candidate.y)
```

Thus the one-tower minimax center can be calculated in `O(|R| + |C|)`. It can be an area rather than a unique tile. This geometric result does not make a six-tower placement automatically optimal.

Use the minimax center region as the starting point for a small, local six-tile placement. Prefer a center with enough nearby feasible construction space, preserve deterministic ties, and validate the completed placement. Do not simply choose six globally tied minimax candidates: the tied region can be long, producing an unintentionally dispersed result.

The exact compact neighborhood size and deterministic local selection rule remain implementation parameters to validate. They are not universal shape thresholds. A central heuristic need not be the best possible compact placement for the subsequent global certificate to be valid.

If no complete compact placement is available, proceed to the diameter-seeded greedy attempt without a central certificate.

### 2. Attempt a cheap optimality certificate

Given a feasible central placement `central`, define:

```text
centralMinimum = minimumDamage(central)
weakRamparts = {rampart in R | damage(central, rampart) == centralMinimum}
weakCount = weakRamparts.length
```

For every candidate `candidate` in the certification set `C`, calculate:

```text
weakSupport(candidate) = sum(attack(distance(candidate, rampart))
                             for rampart in weakRamparts)
```

Keep the six largest values at distinct candidate tiles and sum them:

```text
supportUpper = sum(six largest weakSupport values)
rawUpper = supportUpper / weakCount
```

These six tiles are used to calculate a bound; they are not necessarily a useful actual placement. They may be jointly infeasible if the certificate deliberately relaxes joint construction constraints.

#### Why the bound is valid

For any legal six-tower placement `S`:

```text
minimumDamage(S)
    <= min(damage(S, rampart) for rampart in weakRamparts)
    <= sum(damage(S, rampart) for rampart in weakRamparts) / weakCount
     = sum(weakSupport(tower) for tower in S) / weakCount
    <= supportUpper / weakCount
     = rawUpper
```

The first inequality restricts the minimum to a subset. The second compares a minimum with an average. The equality regroups addition by tower. The last inequality follows because no six distinct candidates exceed the sum of the six largest support values.

Equivalently, if central placement gives each weak rampart `F`, any strictly better placement must raise **all** of them above `F`. If their combined power cannot exceed `weakCount * F`, that is impossible.

No fitted weights, LP solve, or tower-combination search is needed. Choosing the central weak ramparts makes the bound relevant to the current bottleneck; the inequality itself is valid for any nonempty rampart subset.

#### Integer-grid certificate and optional approximation target

Under the attack model above, each tower's attack power and each six-tower total are multiples of 30. Therefore:

```text
integerUpper = 30 * floor(supportUpper / (30 * weakCount))
```

If `integerUpper == centralMinimum`, central placement is globally optimal for **minimum attack power** within the stated candidate/feasibility model. Dispersed placements may tie it. This does not certify the secondary tie-breaks.

Use integer attack values and integer support sums. Revisit the 30-step argument if the attack model changes. An upper bound below the feasible central score indicates an implementation or candidate-set inconsistency, not a successful certificate.

The default decision is exact certification. An explicitly configured quality target `qualityTarget` may optionally allow early termination when:

```text
centralMinimum >= qualityTarget * integerUpper
```

This guarantees at least that fraction of the true optimal minimum attack power. No approximation percentage has been selected as a production default. A loose bound can fail to certify a placement that is already good or even optimal.

### 3. If uncertified, construct one diameter-seeded distributed placement

A greedy construction starting from an empty placement tends to choose its first tower near the minimax center because its first decision is itself a one-tower max-min problem. That provides little exploration beyond the already retained compact central solution. Instead, first place one seed tower near each endpoint of a perimeter diameter, then greedily place the remaining four towers.

#### 3.1 Find a deterministic rampart diameter pair

Choose two outer ramparts `A` and `B` whose Screeps range is maximal:

```text
diameter = max(distance(a, b) for a, b in R)
```

Because the metric is Chebyshev range, the diameter equals:

```text
max(maximumX - minimumX,
    maximumY - minimumY)
```

so a valid diameter pair can be found from coordinate extrema without an `O(|R|^2)` pair search. If several diameter pairs exist, use a stable deterministic tie rule.

The endpoints identify two opposite extreme directions of the final defensive perimeter. They are rampart coordinates, not necessarily legal tower coordinates.

#### 3.2 Choose one seed candidate near A and one near B

For each endpoint `E` in `{A, B}`, consider legal tower candidates under the current construction constraints and excluding a candidate already selected for the other endpoint.

First prefer the tower attack plateau:

```text
nearCandidates(E) = {candidate in C | distance(candidate, E) <= 5}
```

If `nearCandidates(E)` is nonempty, the seed pool is exactly that set. Every candidate in this pool deals the same maximum `600` attack power to `E`, so being range 1 instead of range 5 gives no endpoint benefit.

If no legal candidate is within range 5, find the minimum reachable range:

```text
minimumEndpointRange(E) = min(distance(candidate, E) for candidate in C)

seedPool(E) = {
    candidate in C |
    distance(candidate, E) == minimumEndpointRange(E)
}
```

All candidates in this fallback pool also deal equal attack power to the endpoint because they have the same range.

Within the selected pool, choose the candidate with the highest total attack power over all outer ramparts:

```text
overallDamage(candidate) = sum(attack(distance(candidate, rampart))
                               for rampart in R)

seed(E) = argmax(overallDamage(candidate) for candidate in seedPool(E))
```

Use stable deterministic candidate order for the final tie.

Select both seeds before starting the normal greedy completion:

```text
selected = [seed(A), seed(B)]
```

The two seeds must be distinct and jointly feasible. If the best seed for the second endpoint conflicts with the first, select the best remaining legal candidate using the same endpoint-range and overall-damage rules. Seed-order tie handling must be deterministic. If no jointly feasible pair exists, the distributed attempt fails rather than weakening construction constraints.

This rule gives each diameter endpoint maximum available attack within the range-5 plateau, or the closest possible range when the plateau cannot be reached, while using the remaining freedom to maximize total perimeter contribution.

#### 3.3 Greedily place the remaining four towers

Starting from the two selected endpoint seeds, repeat four times:

1. Enumerate unused candidates that satisfy the current selection-dependent constraints.
2. Evaluate the rampart attack totals after adding one tower at each candidate.
3. Select the best candidate using the comparison below.
4. Add it and update the stored totals and slot reservations.

Compare partial placements lexicographically:

1. Higher minimum rampart attack power.
2. Fewer ramparts at that minimum.
3. Higher total attack power over all ramparts.
4. Stable deterministic candidate order.

The second criterion allows progress when several ramparts share the minimum and one additional tower improves only some of them. Evaluate all ramparts, not only the weakest rampart from the previous step. Do not replace this evaluation with "nearest candidate to one weak rampart."

The endpoint seeds only force the first two towers to cover opposite extremes. The remaining four towers are free to become compact, spread along the perimeter, or move toward the center according to the normal max-min greedy score.

If the greedy prefix leaves no way for the procedure to select six legal towers, discard the incomplete distributed result. Keep a valid central placement if available; otherwise report failure through the planner's existing fallback rather than weaken the construction constraints. This does not prove that no feasible six-tower placement exists.

### 4. Retain the better complete placement

If the distributed greedy placement completes, compare it with central using the same comparator:

1. Higher minimum rampart attack power.
2. Fewer ramparts at that minimum.
3. Higher total attack power over all ramparts.
4. Stable deterministic candidate order.

If scores are identical, prefer central for a stable result. A worse distributed result never replaces a valid central result.

Neither the diameter-seeded greedy result nor failure to improve central proves optimality. Only the stated certificate (or a separate exact validation) supports that claim. Max-min attack placement does not inherit a standard greedy approximation guarantee merely because contributions are additive.

## Procedural summary

```text
central = tryCentralPlacement(candidates, ramparts)

if central exists:
    upper = calculateWeakRampartUpperBound(central, certificationCandidates)
    if central reaches upper:
        return central  // minimum attack power certified optimal
    if an explicit approximation target exists and central meets it:
        return central  // only the configured quality guarantee is certified

[A, B] = findDiameterRampartPair(ramparts)
seedA = chooseEndpointSeed(A, candidates, ramparts)
seedB = chooseEndpointSeed(B, candidates excluding seedA, ramparts)

distributed = tryGreedyCompletion(
    initialTowers = [seedA, seedB],
    candidates,
    ramparts,
    remainingTowerCount = 4,
)

return the better complete feasible placement between central and distributed,
or the existing planner failure
```

## Cost and implementation scope

With `n` candidates, `m` ramparts, and `k` weak ramparts:

- Precomputing candidate/rampart attack values takes `O(n * m)` work and storage.
- The certificate takes `O(n * k)` work. Maintain the top six values without sorting all candidates.
- A Chebyshev diameter pair can be found from rampart coordinate extrema in `O(m)`.
- Endpoint seed selection is `O(n)` per endpoint once candidate/rampart attack totals are cached.
- The greedy completion makes four candidate passes, approximately `O(4 * n * m)` attack evaluations, plus feasibility checks.
- There is no enumeration of six-candidate combinations, repeated swap optimization, LP/MILP dependency, or shape-classification subsystem in the proposed production algorithm.

Use cached numeric attack values, cached per-candidate total rampart damage, and incrementally updated rampart totals. Measure actual Screeps CPU during planning and store the resulting plan. Browser timings are not evidence of live bot CPU cost. Do not introduce a new scheduling framework solely for this algorithm; use existing planner budgeting/failure behavior.

## Alternatives considered

- **LP/MILP in the bot:** keep exact/relaxed solves as development comparators if useful, not a production dependency.
- **Repeated one- or two-tower exchanges:** excluded from the initial design to keep logic and planning cost simple.
- **Hard strip/square/diamond rules:** geometric observations do not account for irregular ramparts or candidate constraints.
- **Fresh greedy from zero:** its first tower is itself a one-tower max-min solution and therefore tends to repeat the central bias already represented by the compact central placement.
- **Seed only one diameter endpoint:** weaker symmetry breaking; seeding both endpoints guarantees that the fallback begins with coverage at both extreme sides before the remaining four towers are optimized.
- **Choose an endpoint from local rampart density:** unnecessary when both diameter endpoints are seeded.
- **Force all fallback towers to remain dispersed:** unnecessary; only the first two towers are endpoint-seeded. The remaining four should be free to choose the best geometry.
- **Greedy alone:** can lose a good compact solution; the central candidate is cheap insurance and may be certifiable.
- **Treat certificate failure as evidence of dispersion:** invalid; an upper bound can be loose.

## Validation and remaining decisions

The agreed simpler algorithm has not yet been benchmarked in the production bot. Before assigning a CPU budget or claiming a typical optimality gap:

- Compare central-only, zero-start greedy, diameter-seeded distributed greedy, and the combined procedure on a varied room set using identical candidate and joint feasibility constraints.
- Include strips, square-like and diamond-like perimeters, irregular/disconnected rampart groups, and constrained safe interiors.
- Check six distinct legal tiles, the inclusive outside-range-3 exclusion, slot reservations, deterministic diameter ties, and joint feasibility of the two endpoint seeds.
- For small problems, compare certificates and scores against exhaustive enumeration; a certificate must never certify a suboptimal score.
- Compare against proven exact optima or valid LP upper bounds when available. A time-limited MILP incumbent is not an upper bound.
- Measure live Screeps CPU, certification rate, distributed-greedy improvement rate, and the distribution of remaining quality gaps.
- Select the compact neighborhood rule and any optional quality target from those results. Do not claim results from the earlier LP-plus-swaps HTML experiment as results of this algorithm.

Further fallback machinery should be considered only if this version demonstrably misses the required quality or feasibility on relevant rooms.
