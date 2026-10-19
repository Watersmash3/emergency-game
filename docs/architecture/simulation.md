# Simulation

The simulation is created with `createSimulation(scenario)` and can run in Vitest with no browser. In the app, `apps/web/src/workers/simulation.worker.ts` owns the instance.

## Time

The step is 50 ms, which is 20 ticks per second. `step(dtMs)` accumulates real elapsed time and runs whole ticks, at most eight per call. `tick()` is the deterministic step tests use.

Movement speed is tiles per second and is applied only inside `tick()`. Systems visit entities in sorted id order. Randomness, when a later system needs it, comes from a mulberry32 generator seeded by the scenario. The current snapshot records the seed and the generator state so a save can resume the same sequence.

## Entities

An entity has a stable string id and optional components:

- `position`: continuous world coordinates. The center of tile `(x, y)` is `(x + 0.5, y + 0.5)`.
- `movement`: speed, remaining waypoints, and the tile the current path was planned for.
- `responder`: display name.
- `teamMembership`: team id.

The training yard's team is a record of member ids, not an entity. Obstacles are blocked cells on the navigation grid, not entities.

## Navigation

Pedestrian movement uses 4-connected A*. Units do not block each other. A path is a list of tile centers. If the destination is blocked, out of bounds, or unreachable, the command is rejected and existing tasks stay as they were.

A team order picks distinct walkable tiles near the clicked tile, preferring that tile and then the nearest tiles. Only the nearest 16 walkable tiles are eligible, so a responder who cannot reach the staging area fails individually. If nobody can reach it, the whole order is rejected.

## Worker messages

Inbound messages are `init` with a scenario, or `command` with a command id and a command. Outbound messages are `ready`, `snapshot`, `command-result`, or `error`. Both directions are parsed with the protocol schemas.

The worker posts a snapshot after every accepted or rejected command, and after any interval that advanced at least one tick. While paused, `step` returns immediately, so the worker does not emit idle snapshots and the tick counter stays still.

## Snapshot

`getSnapshot()` returns the scenario id, tick, pause flag, map size, blocked tiles, team, entities, and tasks. Entity paths are included so the renderer can draw them without pathfinding. The object survives `JSON.parse(JSON.stringify(snapshot))`. IndexedDB is not wired up; this object is the boundary it will use.
