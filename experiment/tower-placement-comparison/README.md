# Tower placement comparison experiment

Browser experiment for comparing the tower-placement strategies explored during the v2 base-planner research.

> Production note (2026-09-15): the production planner no longer chooses between centered and distributed branches. It now uses global max-min greedy seeding followed by two full pair sweeps. See [ADR 0005](../../docs/decisions/0005-tower-placement-local-search.md) and the [tower placement experiment log](../../docs/rewrite-log/2026-09-14-tower-placement-experiments.md). The centered/distributed views below are retained as historical research tools.

It shows:

- compact central beam-search placement from the minimum feasible center-region radius plus three tiles
- cheap central optimality certificate using at least the three lowest-damage ramparts
- diameter-seeded distributed placement with v2 weakest-rampart continuation
- exact/time-limited MILP comparator (GLPK.js)
- the planner placement captured by the experiment implementation

Distributed chooses one seed near each diameter endpoint, then selects the remaining four with the earlier v2 tower logic: find the weakest rampart under the current selection, keep eligible candidates within `minRange + 1` of that rampart, then choose the candidate with the lowest average range to all ramparts (preferring non-slot candidates on ties). There is no median center exclusion. Central uses a width-64 beam over candidates within `minimum feasible center radius + 3`, ordered by min damage, weak-rampart count, total damage, center-distance sum, and stable room-index ties. All comparison strategies use the same tower candidate constraints as the planner snapshot embedded in the experiment. The MILP runs asynchronously (30 s primary limit, 3 s secondary tie-break), while central/distributed/planner results render immediately. Moving to another room or disabling the MILP overlay cancels the active solver worker.

## Run

Serve this directory through a local HTTP server, then open `index.html`:

```bash
cd experiment/tower-placement-comparison
python -m http.server 8000
```

Then open `http://localhost:8000`. Room terrain and room objects are fetched on demand from the public Screeps API for `shardSeason`; the indexed controller-room list is retained locally for navigation. Internet access is also required for structure image assets and GLPK.js.

The original development artifact was a self-contained ~9 MB HTML snapshot. This repo version intentionally keeps the experiment source small by loading room data on demand instead of committing the full shard terrain snapshot.
