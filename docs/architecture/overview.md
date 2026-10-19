# Architecture overview

The game is a pnpm workspace with one application and three packages. Simulation state has a single owner. React and Phaser are views.

```text
content scenario
  -> simulation worker
    -> headless Simulation
      -> snapshots
        -> Zustand
          -> React HUD
          -> Phaser scene
```

Commands travel the other direction. The HUD and the scene call `sendCommand`. The worker parses the message with Zod before the simulation sees it.

## Packages

| Package                 | Responsibility                                           |
| ----------------------- | -------------------------------------------------------- |
| `@emergency/protocol`   | Scenarios, commands, snapshots, and worker messages      |
| `@emergency/simulation` | Entities, navigation, tasks, and the fixed timestep      |
| `@emergency/content`    | Authored scenario data, validated by the protocol schema |
| `apps/web`              | React HUD, Phaser scene, and the worker host             |

Dependency direction is one-way. `protocol` depends only on Zod. `simulation` and `content` depend on `protocol`. The web app depends on all three. The simulation package cannot import React, Phaser, or the DOM. Its TypeScript library is `ES2023`, and ESLint rejects those imports.

## What each layer owns

The simulation owns positions, paths, tasks, equipment, object state, vehicle occupancy, fires, incidents, pause, and tick count. The render snapshot is a plain JSON view. A separate versioned save document is what IndexedDB stores.

Zustand owns the latest snapshot, the previous snapshot used for rendering interpolation, the current selection, and the last command result. Selection is not simulation state. Pausing is.

Phaser owns tiles, tokens, the camera, and pointer input. It places sprites by entity id and never advances the rules.

## Extension points that are intentionally small

- Entities are id plus optional component objects. New behavior adds a component and a system, not a subclass.
- A team order is a shared `groupId` on member move tasks. Later goals can create those tasks without replacing the override rules.
- World coordinates are continuous tile units. The isometric projection lives only in `apps/web`.
- Navigation is a 4-connected grid interface. A road graph can sit beside it later.
