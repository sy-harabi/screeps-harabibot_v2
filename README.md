# HarabiBot v2

A TypeScript rewrite of HarabiBot for [Screeps](https://screeps.com/). The design direction and collaboration rules live in [docs/rewrite-context.md](./docs/rewrite-context.md).

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
- `npm run build` bundles `src/main.ts` as `dist/main.js` for Screeps.
- `npm run push-private` builds and uploads once to your private server.
- `npm run format:write` formats supported files.

## Project layout

```text
src/main.ts       Screeps tick entry point
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

`screeps.json` is ignored by Git. Never commit passwords or tokens. `npm run build` only creates the local bundle and does not connect to any server. The upload command targets the `default` Screeps code branch; change `--branch default` in `package.json` if your private server uses another branch.

## Verification

`npm run check` verifies TypeScript, the production bundle, and formatting. Gameplay behavior is validated on the private server. Introduce targeted verification for complex or high-risk algorithms only when it provides concrete value; the baseline project does not require a unit-test framework.
