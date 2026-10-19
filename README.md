# Emergency Response

A single-player, browser-based tactical emergency response game. The player commands a team or an individual responder. The simulation runs locally in a web worker and does not depend on the renderer.

This repository is a playable training yard: four responders, an engine with a pump and hoses, team movement, individual overrides, equipment retrieval, a locked door that can be forced, and a fire the crew can suppress with an extinguisher or an attack line.

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

| Input             | Action                                                |
| ----------------- | ----------------------------------------------------- |
| Left-click        | Select a responder, object, vehicle, hydrant, or fire |
| Shift-click       | Add or remove a responder from the selection          |
| Drag              | Select the responders inside the box                  |
| Roster or team    | Select that unit and focus the camera                |
| Right-click       | Move, reposition a nozzle, board, interact, or connect a hydrant |
| Shift-right-click | Queue a move, retrieval, door, panel, board, or exit  |
| Command bar       | Actions for the current selection                     |
| F / Home / G      | Focus the selection, fit the yard, or follow          |
| Backspace         | Cancel the selected order                             |
| D                 | Debug coordinates, nodes, ids, and blocked tiles      |
| Saves             | Open save and load without leaving it on the map      |
| Space or Pause    | Pause or resume the simulation                        |
| Mouse wheel       | Zoom                                                  |
| Middle mouse drag | Pan                                                   |

Orders can be issued while paused. Units do not move, and boarding, driving, pump flow, fire growth, and suppression do not progress, until the simulation resumes. A responder carries at most two items. Forcing the training door fetches a Halligan tool from the staging locker when the responder does not already have one. Engine 1 carries its own copies of that equipment, a supply hose, and an attack hose, and can be used only while it is parked. Suppressing the training fire uses an extinguisher from the locker or from the parked engine, or water from a charged attack line. A dry nozzle does not reduce the fire. The carried count on an extinguisher is the remaining suppression agent. Save stores the whole simulation, including pump state, hose routes, and a task that is already in progress. A version 1 save loads with a stopped pump added. Load replaces the running incident only after the file has been validated. Autosave keeps the latest automatic copy and one previous recovery copy, and it does not overwrite a named save.

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
