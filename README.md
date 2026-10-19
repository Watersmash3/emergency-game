# Emergency Response

A single-player, browser-based tactical emergency response game. The player commands a team or an individual responder. The simulation runs locally in a web worker and does not depend on the renderer.

This repository is a playable training yard: four responders, an engine, team movement, individual overrides, equipment retrieval, and a locked door that can be forced.

## Prerequisites

- Node.js 22.12 or newer
- pnpm 12.14

Node 22.15 ships with Corepack 0.32, which still launches pnpm through `bin/pnpm.cjs`. pnpm 12 publishes `bin/pnpm.mjs`, so `corepack pnpm` fails on that Corepack build. Install pnpm 12 with npm instead:

```sh
npm install -g pnpm@12.14.0
```

Confirm `pnpm --version` prints `12.14.0` before installing dependencies.

## Scripts

```sh
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm dev` serves the game at <http://localhost:5173>. `pnpm build` writes a production bundle to `apps/web/dist`.

## Controls

| Input             | Action                                         |
| ----------------- | ---------------------------------------------- |
| Left-click        | Select a responder, object, or vehicle         |
| Team header       | Select the whole team                          |
| Engine row        | Select Engine 1                                |
| Right-click       | Move, board or exit the engine, or interact    |
| Object action     | Retrieve, force a door, or operate a panel     |
| Board / Respond   | Load the crew, drive to staging, and disembark |
| Space or Pause    | Pause or resume the simulation                 |
| Mouse wheel       | Zoom                                           |
| Middle mouse drag | Pan                                            |

Orders can be issued while paused. Units do not move, and boarding, driving, and other interactions do not progress, until the simulation resumes. A responder carries at most two items. Forcing the training door fetches a Halligan tool from the staging locker when the responder does not already have one. Engine 1 carries its own copies of that equipment and can be used only while it is parked.

## Compatibility

- TypeScript 6.0.3. typescript-eslint 8.71 supports TypeScript below 6.1 and does not support TypeScript 7.
- Phaser 4.2, using standard sprites, graphics, cameras, and input. The simulation does not use Phaser physics.
- Vite 8 requires Node.js 22.12 or newer.

## Layout

- `apps/web` renders the world with Phaser and the HUD with React.
- `packages/simulation` is the headless fixed-timestep simulation.
- `packages/protocol` is the Zod contract for scenarios, commands, and snapshots.
- `packages/content` holds the training-yard scenario.
- `docs` describes the architecture, the command model, and the roadmap.
