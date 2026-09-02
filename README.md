# HarabiBot v2

A TypeScript rewrite of HarabiBot for [Screeps](https://screeps.com/). The design direction and collaboration rules live in [writing-block.md](./writing-block.md).

## Requirements

- Node.js 24 (the tested version is in `.node-version`)
- npm 11 or newer
- VS Code is optional; repository settings and extension recommendations are included

## Start developing

```sh
npm install
npm run check
```

Useful commands:

- `npm run typecheck` checks TypeScript without producing files.
- `npm test` runs the test suite once.
- `npm run test:watch` reruns affected tests while coding.
- `npm run build` bundles `src/main.ts` as `dist/main.js` for Screeps.
- `npm run push-private` builds and uploads once to your private server.
- `npm run format:write` formats supported files.

## Project layout

```text
src/main.ts       Screeps tick entry point
test/             Local unit and smoke tests
dist/             Generated Screeps bundle (not committed)
```

The architecture brief suggests `kernel`, `operations`, `capabilities`, `world`, and `infrastructure` as concepts. Add those directories only as implementation gives them real responsibilities.

## Upload to a private server

Create your local deployment configuration:

```powershell
Copy-Item screeps.sample.json screeps.json
```

Edit `screeps.json` with your server hostname, port, branch, and credentials. The sample uses username/password authentication. If your server uses `screepsmod-auth` tokens, remove `email` and `password` and add `"token": "your-token"` instead.

Upload with one command:

```sh
npm run push-private
```

`screeps.json` is ignored by Git. Never commit passwords or tokens. `npm run build` only creates the local bundle and does not connect to any server. The upload command targets the `main` code branch; change `--branch main` in `package.json` if your private server uses another branch.

## Testing Screeps code

Vitest runs outside the game, so tests must supply any Screeps globals used by the subject. `test/main.test.ts` demonstrates the smallest possible `Game` stub. Prefer testing domain logic through explicit inputs; only mock globals at the boundary where Screeps provides them.
