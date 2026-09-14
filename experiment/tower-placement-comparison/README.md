# Tower placement comparison experiment

Browser experiment for comparing tower placement strategies against the current v2 base planner.

It shows:

- compact central placement
- cheap central optimality certificate
- diameter-seeded distributed greedy with median central exclusion
- exact/time-limited MILP comparator (GLPK.js)
- current v2 planner placement

All comparison strategies use the same tower candidate constraints as the planner snapshot embedded in the experiment. The MILP runs asynchronously (30 s primary limit, 3 s secondary tie-break), while central/distributed/current-v2 results render immediately. Moving to another room or disabling the MILP overlay cancels the active solver worker.

## Run

Serve this directory through a local HTTP server, then open `index.html`:

```bash
cd experiment/tower-placement-comparison
python -m http.server 8000
```

Then open `http://localhost:8000`. Room terrain and room objects are fetched on demand from the public Screeps API for `shardSeason`; the indexed controller-room list is retained locally for navigation. Internet access is also required for structure image assets and GLPK.js.

The original development artifact was a self-contained ~9 MB HTML snapshot. This repo version intentionally keeps the experiment source small by loading room data on demand instead of committing the full shard terrain snapshot.
