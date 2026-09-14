# Central-first tower placement design

Date: 2026-09-14
Status: superseded by later tower-placement experiments and ADR 0005

## Historical context

This note recorded the intermediate central-first design: construct a compact central placement, attempt a weak-rampart upper-bound certificate, and fall back to a diameter-seeded distributed greedy placement when the central result was not certified.

That design was useful during the tower-placement investigation, but it is no longer the production direction.

## Why it was superseded

Subsequent MILP comparisons showed that the main remaining errors were local-search errors rather than failures to classify a room as centered or distributed. Repeated single-tower replacement removed many of the gaps, and full two-tower replacement removed almost all of the remaining large errors.

Once pair local search was enabled, a simple global max-min greedy seed performed at least as well as the more complicated centered/distributed initialization. Candidate shortlisting before pair search was also tested and rejected because it frequently removed complementary candidate pairs.

The final production procedure is:

```text
global max-min greedy seed
-> single-tower replacement to convergence
-> full pair sweep
-> full pair sweep
```

See:

- [ADR 0005: Tower placement by greedy seed and local pair search](../decisions/0005-tower-placement-local-search.md)
- [Tower placement experiments: from greedy placement to pair local search](2026-09-14-tower-placement-experiments.md)

The original central/distributed browser experiment is retained as historical research tooling, not as the description of current production behavior.
