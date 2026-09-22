# HarabiBot v2

HarabiBot v2 is an in-progress TypeScript rewrite of HarabiBot for [Screeps](https://screeps.com/).

The rewrite is not a line-by-line port. It is being rebuilt around explicit data flow, ordered colony execution, reusable capabilities, and clearer state ownership. The design direction and collaboration rules are documented in [docs/rewrite-context.md](./docs/rewrite-context.md).

> **Status:** active development. The current vertical slice covers owned-source harvesting, shared hauling and logistics, and income-driven upgrading, but this is not yet a complete autonomous bot.

## Current implementation

Implemented so far:

- Direct colony execution rather than a generic operation tree.
- Per-tick `TickContext` indexes for owned rooms, colony creeps, and future mission creeps.
- Exclusive creep ownership through `colony | mission` assignment, with role stored separately.
- Spawn requests, priority ordering, queueing, and global spawn allocation.
- Colony harvesting with owned-source miners, a shared hauler pool, source ordering, replacement-aware spawn demand, and cached source-economy estimates.
- Income-driven upgrading with planned controller chains and logistics-fed upgrade energy.
- One-tick colony logistics state that matches loaded suppliers to spawn/extension and upgrade-energy requests with storage fallback.
- Dedicated movement and traffic capabilities.
- A runtime base planner with in-game `RoomVisual` output.
- Base-plan persistence through `RawMemory` segments.
- Map/planner primitives including distance transform, Dijkstra maps, flood fill, terrain regions, and min-cut.
- Console options for enabling and disabling base-plan visuals.

The base planner currently covers the core layout, controller/upgrader area, resource endpoints and road tree, labs, structure slots, towers, outer ramparts, rampart access roads, and repair roads. Existing manually placed spawns are respected by the planner.

Still under construction are construction execution, scouting, remotes, combat, empire resource coordination/market logic, and other late-game systems. A persistent mission framework is intentionally deferred until the first real cross-room mission requires it.

## Runtime flow

Each tick currently runs in this order:

```text
segmentManager.pretick()
        |
create TickContext
        |
run colonies
        |
allocate spawns
        |
resolve traffic
        |
segmentManager.endTick()
```

A colony is the operating unit centered on one owned room. Colony-local responsibilities run in explicit gameplay order rather than through a universal `plan/execute` interface.

The implemented colony economy currently flows explicitly through harvesting, upgrading, and logistics:

```text
Colony:<roomName>
├─ harvest
│  ├─ miners
│  ├─ shared hauler pool
│  └─ sustainable income estimate
├─ upgrade
│  └─ target WORK from current harvest income
└─ logistics
   ├─ loaded suppliers
   └─ spawn/extension and upgrade-energy requests
```

Subsystems pass derived results directly when later colony work depends on earlier work. For example, harvest returns the current sustainable income estimate used by upgrading rather than publishing that value through generic shared state.

Creeps belong to exactly one colony or mission. `TickContext` derives per-tick rosters from creep memory instead of storing persistent creep-name rosters on owners.

Missions are reserved for independent persistent goals such as future assault, claim, power-bank, or remote-defense work. No generic mission framework is created before such a lifecycle is needed.

Capabilities provide reusable mechanisms such as base planning, spawning, movement, and traffic. Temporary indexes belong to the per-tick layer, while disposable cross-tick caches remain owned by their domains and are registered through the runtime registry when appropriate.

## Project layout

```text
src/main.ts                         Screeps tick entry point
src/kernel/                         Tick context and low-level tick coordination
src/colony/                         Ordered colony execution
  colonyManager.ts
  harvest/
  logistics/
  upgrade/
src/creeps/                         Creep ownership types
src/capabilities/basePlanning/      Runtime base planner
src/capabilities/spawning/          Spawn requests, queue, priority, allocator
src/capabilities/movement/          Movement, path state, and traffic
src/world/map/                      Map algorithms and room-grid utilities
src/persistence/                    RawMemory segment lifecycle
src/runtime/                        Runtime-only registries/caches
src/options/                        Bot option definitions
src/console/                        Screeps console API
src/visuals/                        RoomVisual helpers
docs/decisions/                     Architecture/design decision history
docs/rewrite-log/                   Rewrite and experiment notes
experiment/                         Standalone research/visualization experiments
dist/                               Generated bundle; not committed
```

## Requirements

- Node.js 24 (`.node-version` contains the tested version)
- npm 11 or newer
- VS Code is optional; repository settings and extension recommendations are included

## Start developing

```sh
npm ci
npm run check
```

Useful commands:

- `npm run typecheck` — check TypeScript without emitting files.
- `npm run build` — bundle `src/main.ts` as `dist/main.js`.
- `npm run check` — run type checking, linting, production build, and formatting checks.
- `npm run format` — check formatting without changing files.
- `npm run format:write` — format supported files.
- `npm run push-private` — build and upload once to the configured private server.

## Formatting

Formatting is shared through `.prettierrc.json`, `.editorconfig`, `.gitattributes`, and `.prettierignore`. Prettier 3.9.6 is pinned in `package.json` and `package-lock.json`; use `npm ci` after cloning to install the locked dependencies.

The project uses a print width of 120, omits optional semicolons, uses double quotes and trailing commas where supported, and uses two-space indentation and LF line endings. Markdown prose keeps its existing wrapping. Prettier may retain semicolons where needed to preserve JavaScript semantics.

VS Code workspace settings select the repository-local Prettier module and enable formatting on save. Install the recommended Prettier extension; other editors and agents should use the same local package and configuration through the npm commands. Personal editor formatting preferences are not the project standard.

For a focused change, format only the files you edited:

```sh
npm exec -- prettier --write path/to/changed-file.ts
npm run format
```

`npm run format:write` formats the whole repository when an intentional style update requires it. Generated output, dependencies, the npm lockfile, and the maintained rewrite context are excluded by `.prettierignore`. CI checks formatting on pushes and pull requests alongside type checking and the production build.

## Upload to a private server

Copy the included sample configuration:

```powershell
Copy-Item screeps.sample.json screeps.json
```

Or on a POSIX shell:

```sh
cp screeps.sample.json screeps.json
```

Edit the `private` entry in `screeps.json` with your server hostname, port, and credentials. The included sample uses username/password authentication. If the server uses `screepsmod-auth` tokens, replace `email` and `password` with:

```json
"token": "YOUR_TOKEN"
```

Then upload:

```sh
npm run push-private
```

`push-private` selects the `private` server entry and uploads `dist/main.js` to the Screeps `default` code branch. `screeps.json` is ignored by Git; never commit real passwords or tokens.

## Screeps console

The bot exposes a small console API:

```js
bot.help()
bot.options.show()
bot.options.setBasePlanVisual(true)
bot.options.setBasePlanVisual(false)
bot.options.clearBasePlanVisual()
```

Base-plan visuals are disabled by default.

## Design notes

Start with these documents when reading the rewrite:

- [Rewrite context](./docs/rewrite-context.md) — overall direction and current architecture rules.
- [Design decisions](./docs/decisions/README.md) — planner, persistence, runtime, and other architectural decisions.
- [Rewrite log](./docs/rewrite-log/README.md) — chronological development and experiment notes.

## Verification

`npm run check` verifies TypeScript, lint rules, the production bundle, and formatting. Gameplay behavior is validated in Screeps. Targeted tests or experiments are added for algorithms where they provide concrete value; the project does not currently require a general-purpose unit-test framework.
