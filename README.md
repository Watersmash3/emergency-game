# Emergency Response

A single-player, browser-based tactical emergency response game. The player commands a team or an individual responder. The simulation runs locally in a web worker and does not depend on the renderer.

This repository is a playable training yard: four responders, an engine with a pump and hoses, team movement, individual overrides, equipment retrieval, a training building with two rooms, and a fire the crew can suppress with an extinguisher or an attack line.

## Prerequisites

- Node.js 22.12 or newer
- pnpm 12.14, the version named in `package.json` under `packageManager`

Node.js 22.15 includes Corepack 0.32. That build launches pnpm from `bin/pnpm.cjs`. pnpm 12 ships `bin/pnpm.mjs`, so the first `pnpm` command downloads the package and then exits with `Cannot find module ... pnpm.cjs`. Installing pnpm with npm does not replace that Corepack command: `C:\Program Files\nodejs\pnpm.ps1` stays earlier on `PATH`.

After that first attempt, Corepack has pnpm 12.14.0 cached. Point the launcher at the file that exists. In PowerShell:

```powershell
$bin = Join-Path $env:LOCALAPPDATA "node\corepack\v1\pnpm\12.14.0\bin"
@'
const { pathToFileURL } = require("node:url");
const entry = process.argv[1].replace(/\.cjs$/, ".mjs");
process.argv[1] = entry;
import(pathToFileURL(entry).href);
'@ | Set-Content -Path (Join-Path $bin "pnpm.cjs") -Encoding ascii
Copy-Item (Join-Path $bin "pnpm.cjs") (Join-Path $bin "pnpx.cjs") -Force
pnpm --version
```

`pnpm --version` should print `12.14.0`. Repeat the snippet if a later Corepack download removes those two files.

## Run the game

From the repository root:

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The dev server stays running until you stop it. The training yard loads on its own: four responders, Engine 1, the training building, and the fire south of the entrance.

Other checks from the same directory:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm build` writes the production bundle to `apps/web/dist`. To serve that bundle:

```sh
pnpm --dir apps/web preview
```

The preview server prints its address. It is usually <http://localhost:4173>.

## Controls

| Input             | Action                                                |
| ----------------- | ----------------------------------------------------- |
| Left-click        | Select a responder, object, vehicle, hydrant, fire, or room |
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
| Settings          | Camera, debug, and roof visibility                    |
| Space or Pause    | Pause or resume the simulation                        |
| Mouse wheel       | Zoom                                                  |
| Middle mouse drag | Pan                                                   |

Orders can be issued while paused. Units do not move, and boarding, driving, pump flow, fire growth, suppression, and room search do not progress, until the simulation resumes. A responder carries at most two items. Forcing the locked training door fetches a Halligan tool from the staging locker when the responder does not already have one and leaves that door forced. The interior door can be opened without a tool. The training building has an entry room and a north room. Search the selected room, or order the team to search the building. Engine 1 carries its own copies of that equipment, a supply hose, and an attack hose, and can be used only while it is parked. Suppressing the training fire uses an extinguisher from the locker or from the parked engine, or water from a charged attack line. A dry nozzle does not reduce the fire. The carried count on an extinguisher is the remaining suppression agent. Save stores the whole simulation, including door states, room search, pump state, hose routes, and a task that is already in progress. Older version 2 saves still load; they have no building records. A version 1 save loads with a stopped pump added. Load replaces the running incident only after the file has been validated. Autosave keeps the latest automatic copy and one previous recovery copy, and it does not overwrite a named save.

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
