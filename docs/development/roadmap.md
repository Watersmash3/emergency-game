# Roadmap

## Implemented

- pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest, and a Vite production build
- Headless simulation with entities, fixed 20 Hz ticks, seeded randomness, and JSON snapshots
- 4-connected pedestrian A* and explicit rejection of bad move orders
- Web worker host and Zod-validated messages
- Isometric training yard with four responders, selection, camera pan and zoom, and debug paths
- Team move, individual override, and resume of the suspended team order
- Tactical pause that stops time and still accepts orders
- Locker, locked door, and control panel interactions
- Equipment retrieval, inventory slots, and exclusive reservations
- Multi-step force-door, including fetching a Halligan tool
- Team equipment retrieval that keeps working when one member is overridden

## Next milestone

One small structure-fire scenario on this command model:

- A building with a door and a few rooms, still on one floor
- A fire state that spreads on a slower tick than movement
- A suppress order that requires a responder to carry an extinguisher to an operating position
- The same override rules: pulling one firefighter off the line does not cancel the crew

## Deliberately deferred

- Drag-select, shift-queue, and number-key groups
- IndexedDB save slots and migrations
- Tiled map import
- Vehicles, road graphs, and traffic
- Police, EMS, extrication, hazmat, and civilians
- Multi-floor interiors
- Speed controls other than pause
- Networking, accounts, and payments
