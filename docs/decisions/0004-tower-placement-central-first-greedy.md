# Central-first tower placement with a greedy fallback

Status: accepted (design direction; production implementation pending)
Date: 2026-09-14

## Context

Tower placement should produce a strong six-tower defense with a small, predictable planning cost and little algorithmic machinery. The primary objective is the lowest combined tower attack power over the final outer ramparts.

Experiments suggested that narrow strips often favor dispersed towers, approximately square perimeters often favor concentration, and diamond-shaped perimeters can favor dispersion sooner. These are observations, not sufficient classification rules. Terrain, safe construction candidates, and the attack falloff plateaus change the outcome.

The agreed production direction is:

```text
try a compact central placement
    -> certify its minimum attack power when possible
    -> if not certified, try a fresh six-step greedy placement
    -> keep the better feasible placement
```

A failed certificate means **unknown**, not **central placement is inferior**. The greedy result must be compared against the central result.

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

If no complete compact placement is available, proceed to the greedy attempt without a central certificate.

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

### 3. If uncertified, construct a fresh greedy placement

Start from an empty placement, not from the central towers. Repeat six times:

1. Enumerate unused candidates that satisfy the current selection-dependent constraints.
2. Evaluate the rampart attack totals after adding one tower at each candidate.
3. Select the best candidate using the comparison below.
4. Add it and update the stored totals and slot reservations.

Compare both partial placements and the final central/greedy results lexicographically:

1. Higher minimum rampart attack power.
2. Fewer ramparts at that minimum.
3. Higher total attack power over all ramparts.
4. Stable deterministic candidate order.

The second criterion allows progress when several ramparts share the minimum and one additional tower improves only some of them. Evaluate all ramparts, not only the weakest rampart from the previous step. Do not replace this evaluation with "nearest candidate to one weak rampart."

Greedy is allowed to produce a compact result. "Dispersed fallback" describes its freedom to use the whole candidate set; it is not a requirement to force towers apart.

If a greedy prefix leaves no way for the current procedure to select six legal towers, discard that incomplete result. Keep a valid central placement if available; otherwise report failure through the planner's existing fallback rather than weaken the construction constraints. This does not prove that no feasible six-tower placement exists.

### 4. Retain the better complete placement

If greedy completes, compare it with central using the same comparator and retain the better one. If both have identical scores, prefer central for a stable result. A worse greedy result never replaces a valid central result.

Neither six-step greedy nor failure to improve central proves optimality. Only the stated certificate (or a separate exact validation) supports that claim. Max-min attack placement does not inherit a standard greedy approximation guarantee merely because contributions are additive.

## Procedural summary

```text
central = tryCentralPlacement(candidates, ramparts)

if central exists:
    upper = calculateWeakRampartUpperBound(central, certificationCandidates)
    if central reaches upper:
        return central  // minimum attack power certified optimal
    if an explicit approximation target exists and central meets it:
        return central  // only the configured quality guarantee is certified

greedy = tryGreedyPlacement(candidates, ramparts, towerCount = 6)

return the better complete feasible placement, or the existing planner failure
```

## Cost and implementation scope

With `n` candidates, `m` ramparts, and `k` weak ramparts:

- Precomputing candidate/rampart attack values takes `O(n * m)` work and storage.
- The certificate takes `O(n * k)` work. Maintain the top six values without sorting all candidates.
- Greedy makes six candidate passes, approximately `O(6 * n * m)` attack evaluations, plus feasibility checks.
- There is no enumeration of six-candidate combinations, repeated swap optimization, LP/MILP dependency, or shape-classification subsystem in the proposed production algorithm.

Use cached numeric attack values and incrementally updated rampart totals. Measure actual Screeps CPU during planning and store the resulting plan. Browser timings are not evidence of live bot CPU cost. Do not introduce a new scheduling framework solely for this algorithm; use existing planner budgeting/failure behavior.

## Alternatives considered

- **LP/MILP in the bot:** keep exact/relaxed solves as development comparators if useful, not a production dependency.
- **Repeated one- or two-tower exchanges:** excluded from the initial design to keep logic and planning cost simple.
- **Hard strip/square/diamond rules:** geometric observations do not account for irregular ramparts or candidate constraints.
- **Greedy alone:** can lose a good compact solution; the central candidate is cheap insurance and may be certifiable.
- **Treat certificate failure as evidence of dispersion:** invalid; an upper bound can be loose.

## Validation and remaining decisions

The agreed simpler algorithm has not yet been benchmarked in the production bot. Before assigning a CPU budget or claiming a typical optimality gap:

- Compare central-only, greedy-only, and the combined procedure on a varied room set using identical candidate and joint feasibility constraints.
- Include strips, square-like and diamond-like perimeters, irregular/disconnected rampart groups, and constrained safe interiors.
- Check six distinct legal tiles, the inclusive outside-range-3 exclusion, slot reservations, and deterministic ties.
- For small problems, compare certificates and scores against exhaustive enumeration; a certificate must never certify a suboptimal score.
- Compare against proven exact optima or valid LP upper bounds when available. A time-limited MILP incumbent is not an upper bound.
- Measure live Screeps CPU, certification rate, greedy improvement rate, and the distribution of remaining quality gaps.
- Select the compact neighborhood rule and any optional quality target from those results. Do not claim results from the earlier LP-plus-swaps HTML experiment as results of this algorithm.

Further fallback machinery should be considered only if this version demonstrably misses the required quality or feasibility on relevant rooms.
