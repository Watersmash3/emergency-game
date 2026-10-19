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
- Engine 1 as a vehicle entity with its own occupants, seats, and stored equipment
- Road-graph navigation, crew boarding, and a compound respond order
- A training-yard fire incident with tick-driven growth, fuel, and suppression
- Individual `suppress-fire` and team `suppress-incident` orders, including reassignment after an override
- Versioned local saves, load, delete, and a rotating autosave in IndexedDB

## Next milestone

Group selection and queued orders, so one responder can be given a second order without losing the first.

## Deliberately deferred

- Drag-select, shift-queue, and number-key groups
- Save migrations beyond schema version 1
- Tiled map import
- Vehicle steering, traffic, pumps, hoses, and ladders
- Police, EMS, extrication, hazmat, and civilians
- Multi-floor interiors
- Speed controls other than pause
- Networking, accounts, and payments
