# Simulation

The simulation is created with `createSimulation(scenario)` and can run in Vitest with no browser. In the app, `apps/web/src/workers/simulation.worker.ts` owns the instance.

## Time

The step is 50 ms, which is 20 ticks per second. `step(dtMs)` accumulates real elapsed time and runs whole ticks, at most eight per call. `tick()` is the deterministic step tests use.

Movement speed is tiles per second and is applied only inside `tick()`. Systems visit entities in sorted id order. Randomness, when a later system needs it, comes from a mulberry32 generator seeded by the scenario. The current snapshot records the seed and the generator state so a save can resume the same sequence.

## Entities

An entity has a stable string id and optional components:

- `position`: continuous world coordinates. The center of tile `(x, y)` is `(x + 0.5, y + 0.5)`.
- `movement`: speed, remaining waypoints, and the tile the current path was planned for.
- `responder`: display name, and the vehicle id while the responder is aboard.
- `teamMembership`: team id.
- `interactable`: object type, state, required capability, and the tiles a responder must stand on.
- `vehicle`: definition, heading, footprint, seats, occupants, driver, road node, status, and an optional pump.
- `hydrant`: name, availability, flow capacity, the connected hose, and the tiles a responder must stand on.
- `hose`: kind, stored equipment, maximum length, deployed route, connection state, source, target, operator, and current flow.
- `fire`: name, intensity, maximum intensity, fuel, growth per tick, fuel use per tick, and suppression range.

The training yard's team is a record of member ids and an optional apparatus id, not an entity. Occupancy is stored on the vehicle. It is not inferred from team membership. Incidents and objectives are also records. An incident stays active until every objective is satisfied. The training fire's objective is satisfied when that fire's intensity reaches zero.

Obstacles are blocked cells on the navigation grid. A locked door is also a blocked cell until a force-door task opens it. A fire occupies a walkable tile and does not block movement. Equipment instances live beside the entities: each one is in a locker, stored on a stationary vehicle, or carried by one responder, and a task may reserve it. A suppress-capable item also carries a remaining agent count and a catalog suppression rate.

## Navigation

Pedestrian movement uses 4-connected A*. Units do not block each other. A path is a list of tile centers. If the destination is blocked, out of bounds, or unreachable, the command is rejected and existing tasks stay as they were.

Vehicles use a separate road graph. A* runs over road nodes and bidirectional edges. A vehicle moves from node center to node center at its speed and turns to face the current segment. It does not use pedestrian routes, and it does not block them. An unknown or disconnected destination is rejected before anyone boards.

A team order picks distinct walkable tiles near the clicked tile, preferring that tile and then the nearest tiles. Only the nearest 16 walkable tiles are eligible, so a responder who cannot reach the staging area fails individually. If nobody can reach it, the whole order is rejected. A responder who is aboard a vehicle is not given a pedestrian path.

## Worker messages

Inbound messages are `init` with a scenario, or `command` with a command id and a command. Outbound messages are `ready`, `snapshot`, `command-result`, or `error`. Both directions are parsed with the protocol schemas.

The worker posts a snapshot after every accepted or rejected command, and after any interval that advanced at least one tick. While paused, `step` returns immediately, so the worker does not emit idle snapshots and the tick counter stays still.

## Snapshot

`getSnapshot()` returns the scenario id, tick, pause flag, map size, blocked tiles, team, responders, world objects, vehicles, hydrants, hoses, road nodes and edges, fires, incidents, inventory capacity, tasks, queued orders, and recent notices. A vehicle with a pump includes tank level, pump state, pressure, supply intake, and attack discharges. Hose length is the deployed route length. Entity paths are included so the renderer can draw them without pathfinding. An aboard responder's position is derived from the vehicle. Fire intensity, fuel, and incident state are included so the HUD can show them without reading the simulation internals. The object survives `JSON.parse(JSON.stringify(snapshot))`.

## Saves

The render snapshot is not a save file. `exportSave()` writes schema version 2, a portable document with entities, components, equipment, reservations, seats, road reservations, pump state, hydrants, hoses, incidents, task progress, queued orders, notices, the tick, the pause flag, and the RNG state. Orders and notices default to empty on older version 2 documents. A version 1 document is migrated by adding a stopped pump to each vehicle that has no pump field. It is taken between ticks, so a partial frame is not stored. `restoreSimulation()` parses that document, rebuilds the maps the simulation uses, and checks occupancy, ownership, reservations, and hose connections. It does not run the original commands again. A failed restore returns a message and leaves the caller's simulation in place.

The browser keeps those documents in IndexedDB. Manual saves are listed ahead of the automatic slots. Autosave starts after a command or a load, then every 100 completed ticks writes an `autosave` record and keeps the previous one as `Previous recovery`. Reloading the page does not replace that recovery with the opening layout. A storage or quota failure is reported and does not replace the running simulation. A loaded snapshot fits the training yard in the viewport and places responders at the saved coordinates immediately.

## Fire

`stepFire` runs after water accounting and before tasks. A burning fire with fuel increases intensity by its growth, capped at the maximum, and decreases fuel by its fuel use. Fuel at zero stops growth. It does not put the fire out. Suppression is the only way intensity reaches zero. There is no random spread and no second fire.

`stepWater` runs after vehicle movement and before fire growth. It clears delivered flow, stops a pump whose vehicle is moving, and adds hydrant water to the tank when the pump is operating and its supply valve is open. Attack lines consume tank water later in the same tick, so a hydrant that matches the attack demand keeps the tank supplied. Water is not created when the pump is off or the tank and supply are empty.

After tasks and incident checks, the tick promotes one queued order per free responder and records status notices. A notice is emitted when a condition changes, so a warning is not repeated on every tick.

Pause returns before any system runs, so a paused tick does not grow a fire, move water, apply suppression, or promote a queue. A command issued while paused can still start its task immediately.
