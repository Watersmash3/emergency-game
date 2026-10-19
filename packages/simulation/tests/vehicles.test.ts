import { describe, expect, it } from 'vitest';

import { CommandRejection, type Simulation } from '../src/index.ts';
import { entityAt, simulation, tasksFor } from './helpers.ts';

const roads = [
  { id: 'spawn', position: { x: 1, y: 4 }, kind: 'spawn' as const },
  { id: 'east', position: { x: 8, y: 4 }, kind: 'intersection' as const },
  { id: 'stage', position: { x: 8, y: 10 }, kind: 'staging' as const },
  { id: 'island', position: { x: 4, y: 12 }, kind: 'staging' as const },
];

const edges = [
  { from: 'spawn', to: 'east' },
  { from: 'east', to: 'stage' },
];

function engine(
  input: {
    capacity?: number;
    speed?: number;
    responders?: { id: string; name: string; position: { x: number; y: number }; speed: number }[];
    blocked?: { x: number; y: number }[];
    apparatusId?: string;
    equipment?: { id: string; definitionId: string; locationId: string }[];
  } = {},
): Simulation {
  const responders = input.responders ?? [
    { id: 'a', name: 'A', position: { x: 1, y: 4 }, speed: 20 },
    { id: 'b', name: 'B', position: { x: 2, y: 4 }, speed: 20 },
    { id: 'c', name: 'C', position: { x: 1, y: 5 }, speed: 20 },
    { id: 'd', name: 'D', position: { x: 2, y: 5 }, speed: 20 },
  ];
  return simulation({
    width: 16,
    height: 16,
    blocked: input.blocked,
    responders,
    memberIds: responders.map((responder) => responder.id),
    apparatusId: input.apparatusId === '' ? undefined : (input.apparatusId ?? 'engine'),
    vehicleCatalog: [
      {
        id: 'fire_engine_standard',
        capacity: input.capacity ?? 4,
        speed: input.speed ?? 40,
        footprint: { width: 2, height: 1 },
      },
    ],
    vehicles:
      input.apparatusId === ''
        ? []
        : [
            {
              id: 'engine',
              name: 'Engine 1',
              definitionId: 'fire_engine_standard',
              nodeId: 'spawn',
              heading: 0,
            },
          ],
    roadNodes: roads,
    roadEdges: edges,
    ...(input.equipment
      ? {
          equipmentCatalog: [
            { id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] },
            { id: 'medical-bag', name: 'Medical bag', capabilities: ['medical'] },
            { id: 'extinguisher', name: 'Fire extinguisher', capabilities: ['extinguish'] },
          ],
          equipment: input.equipment,
        }
      : {}),
  });
}

function apparatus(sim: Simulation) {
  const vehicle = sim.getSnapshot().vehicles[0];
  if (!vehicle) throw new Error('missing vehicle');
  return vehicle;
}

function until(sim: Simulation, predicate: () => boolean, limit = 240): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  throw new Error('timed out');
}

describe('vehicles', () => {
  it('boards a responder into a reserved seat', () => {
    const sim = engine();
    expect(sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => apparatus(sim).occupants.some((occupant) => occupant.id === 'a'));
    expect(entityAt(sim, 'a').aboardVehicleId).toBe('engine');
    expect(apparatus(sim).driverId).toBe('a');
    expect(
      Math.hypot(
        entityAt(sim, 'a').position.x - apparatus(sim).position.x,
        entityAt(sim, 'a').position.y - apparatus(sim).position.y,
      ),
    ).toBeLessThan(1);
  });

  it('rejects a second board once the only seat is reserved', () => {
    const sim = engine({ capacity: 1 });
    expect(sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    const second = sim.apply({ type: 'board-vehicle', responderId: 'b', vehicleId: 'engine' });
    expect(second).toEqual({ ok: false, reason: CommandRejection.Full });
  });

  it('releases the seat when boarding is cancelled', () => {
    const sim = engine({ capacity: 1 });
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    sim.tick();
    const boarding = tasksFor(sim, 'a').find((task) => task.kind === 'board-vehicle');
    expect(boarding?.state).toBe('running');
    expect(sim.apply({ type: 'cancel-task', taskId: boarding?.id ?? '' })).toEqual({ ok: true });
    expect(tasksFor(sim, 'a').find((task) => task.kind === 'board-vehicle')?.failureReason).toBe(
      CommandRejection.Interrupted,
    );
    expect(sim.apply({ type: 'board-vehicle', responderId: 'b', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => apparatus(sim).occupants.some((occupant) => occupant.id === 'b'));
    expect(apparatus(sim).occupants.map((occupant) => occupant.id)).toEqual(['b']);
  });

  it('disembarks onto a walkable tile and restores pedestrian control', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => Boolean(entityAt(sim, 'a').aboardVehicleId));
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 4, y: 4 } }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.Aboard,
    });
    expect(sim.apply({ type: 'exit-vehicle', responderId: 'a', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => !entityAt(sim, 'a').aboardVehicleId);
    expect(apparatus(sim).occupants).toEqual([]);
    expect(apparatus(sim).driverId).toBeNull();
    const stood = entityAt(sim, 'a').position;
    expect(stood.x !== apparatus(sim).position.x || stood.y !== apparatus(sim).position.y).toBe(
      true,
    );
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 4, y: 4 } }).ok,
    ).toBe(true);
    const before = entityAt(sim, 'a').position;
    sim.tick();
    sim.tick();
    expect(entityAt(sim, 'a').position).not.toEqual(before);
  });

  it('requires the designated driver before the vehicle moves', () => {
    const sim = engine();
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.NoDriver,
    });
    sim.apply({ type: 'board-vehicle', responderId: 'b', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).occupants.some((occupant) => occupant.id === 'b'));
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.NoDriver,
    });
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' }).ok,
    ).toBe(true);
  });

  it('drives the road graph and stops at the staging node', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' });
    until(sim, () => apparatus(sim).status === 'idle' && apparatus(sim).nodeId === 'stage');
    expect(apparatus(sim).position).toEqual({ x: 8.5, y: 10.5 });
    expect(apparatus(sim).destinationNodeId).toBeNull();
  });

  it('rejects an unreachable vehicle destination', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    const before = apparatus(sim).position;
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'island' }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.Unreachable,
    });
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'missing' }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.UnknownNode,
    });
    sim.tick();
    expect(apparatus(sim).position).toEqual(before);
  });

  it('carries occupants along the vehicle path', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    sim.apply({ type: 'board-vehicle', responderId: 'b', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).occupants.length === 2);
    sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'east' });
    until(sim, () => apparatus(sim).nodeId === 'east');
    for (const id of ['a', 'b']) {
      const person = entityAt(sim, id);
      const vehicle = apparatus(sim);
      expect(person.aboardVehicleId).toBe('engine');
      expect(
        Math.hypot(person.position.x - vehicle.position.x, person.position.y - vehicle.position.y),
      ).toBeLessThan(1);
    }
  });

  it('boards the whole team', () => {
    const sim = engine();
    expect(sim.apply({ type: 'board-team', teamId: 'engine-1', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => apparatus(sim).occupants.length === 4);
    expect(
      apparatus(sim)
        .occupants.map((occupant) => occupant.id)
        .sort(),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(sim.apply({ type: 'disembark-team', teamId: 'engine-1', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => apparatus(sim).occupants.length === 0);
    expect(entityAt(sim, 'a').aboardVehicleId).toBeUndefined();
  });

  it('does not fail a member who is already aboard when the team boards', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    expect(sim.apply({ type: 'board-team', teamId: 'engine-1', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(sim, () => apparatus(sim).occupants.length === 4);
    expect(tasksFor(sim, 'a').some((task) => task.state === 'failed')).toBe(false);
    expect(apparatus(sim).occupants.map((occupant) => occupant.id)).toContain('a');
  });

  it('does not depart when the driver takes an individual order', () => {
    const sim = engine({
      responders: [
        { id: 'a', name: 'A', position: { x: 1, y: 4 }, speed: 1 },
        { id: 'b', name: 'B', position: { x: 1, y: 4 }, speed: 20 },
      ],
    });
    expect(
      sim.apply({
        type: 'respond-to',
        teamId: 'engine-1',
        destinationNodeId: 'stage',
        disembark: false,
      }).ok,
    ).toBe(true);
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 1, y: 1 } }).ok,
    ).toBe(true);
    until(sim, () =>
      tasksFor(sim, 'engine').some((task) => task.kind === 'respond' && task.state === 'failed'),
    );
    expect(tasksFor(sim, 'engine').find((task) => task.kind === 'respond')?.failureReason).toBe(
      CommandRejection.NoDriver,
    );
    expect(apparatus(sim).status).not.toBe('moving');
    expect(apparatus(sim).nodeId).toBe('spawn');
    expect(apparatus(sim).occupants.map((occupant) => occupant.id)).not.toContain('a');
  });

  it('rejects a response when the driver is already on an individual order', () => {
    const sim = engine();
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 6, y: 6 } });
    expect(
      sim.apply({
        type: 'respond-to',
        teamId: 'engine-1',
        destinationNodeId: 'stage',
        disembark: true,
      }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.NoDriver,
    });
    expect(apparatus(sim).occupants).toEqual([]);
  });

  it('responds, parks, and disembarks the crew', () => {
    const sim = engine({
      responders: [
        { id: 'a', name: 'A', position: { x: 1, y: 4 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 2, y: 4 }, speed: 20 },
      ],
    });
    expect(
      sim.apply({
        type: 'respond-to',
        teamId: 'engine-1',
        destinationNodeId: 'stage',
        disembark: true,
      }).ok,
    ).toBe(true);
    until(sim, () => apparatus(sim).nodeId === 'stage' && apparatus(sim).occupants.length === 0);
    expect(apparatus(sim).status).toBe('idle');
    expect(entityAt(sim, 'a').aboardVehicleId).toBeUndefined();
    expect(entityAt(sim, 'b').aboardVehicleId).toBeUndefined();
    expect(tasksFor(sim, 'engine').find((task) => task.kind === 'respond')?.state).toBe(
      'completed',
    );
  });

  it('stops a cancelled transport without removing occupants', () => {
    const sim = engine();
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' });
    sim.tick();
    const drive = tasksFor(sim, 'engine').find((task) => task.kind === 'drive-vehicle');
    expect(sim.apply({ type: 'cancel-task', taskId: drive?.id ?? '' })).toEqual({ ok: true });
    expect(apparatus(sim).status).toBe('idle');
    expect(apparatus(sim).occupants.map((occupant) => occupant.id)).toEqual(['a']);
    expect(entityAt(sim, 'a').aboardVehicleId).toBe('engine');
    expect(
      sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' }).ok,
    ).toBe(true);
  });

  it('retrieves equipment from a stationary vehicle without duplicating it', () => {
    const sim = engine({
      equipment: [{ id: 'tool', definitionId: 'halligan', locationId: 'engine' }],
    });
    expect(apparatus(sim).contents.map((item) => item.id)).toEqual(['tool']);
    sim.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(sim, () => apparatus(sim).driverId === 'a');
    sim.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'east' });
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'b',
        lockerId: 'engine',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: false, reason: CommandRejection.VehicleMoving });
    until(sim, () => apparatus(sim).status === 'idle');
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'b',
        lockerId: 'engine',
        definitionId: 'halligan',
      }).ok,
    ).toBe(true);
    until(sim, () => entityAt(sim, 'b').inventory.some((item) => item.id === 'tool'));
    expect(apparatus(sim).contents).toEqual([]);
    expect(entityAt(sim, 'b').inventory).toHaveLength(1);
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'c',
        lockerId: 'engine',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: false, reason: CommandRejection.NoEquipment });
  });

  it('freezes vehicle movement and boarding while paused', () => {
    const moving = engine();
    moving.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(moving, () => apparatus(moving).driverId === 'a');
    moving.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'stage' });
    moving.tick();
    const tick = moving.getSnapshot().tick;
    const position = apparatus(moving).position;
    expect(moving.apply({ type: 'pause' }).ok).toBe(true);
    expect(moving.step(1000)).toBe(0);
    expect(moving.getSnapshot().tick).toBe(tick);
    expect(apparatus(moving).position).toEqual(position);
    expect(moving.apply({ type: 'resume' }).ok).toBe(true);
    moving.tick();
    expect(apparatus(moving).position).not.toEqual(position);

    const boarding = engine();
    boarding.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(
      boarding,
      () =>
        (tasksFor(boarding, 'a').find((task) => task.kind === 'board-vehicle')?.progressTicks ??
          0) > 0,
    );
    const progress = tasksFor(boarding, 'a').find(
      (task) => task.kind === 'board-vehicle',
    )?.progressTicks;
    const boardedTick = boarding.getSnapshot().tick;
    boarding.apply({ type: 'pause' });
    boarding.step(1000);
    expect(boarding.getSnapshot().tick).toBe(boardedTick);
    expect(
      tasksFor(boarding, 'a').find((task) => task.kind === 'board-vehicle')?.progressTicks,
    ).toBe(progress);
    expect(entityAt(boarding, 'a').aboardVehicleId).toBeUndefined();
  });

  it('reports an unavailable vehicle and a blocked boarding position', () => {
    const bare = engine({ apparatusId: '' });
    expect(
      bare.apply({
        type: 'respond-to',
        teamId: 'engine-1',
        destinationNodeId: 'stage',
        disembark: true,
      }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.NoVehicle,
    });

    const boxed = engine({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      blocked: [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    });
    expect(boxed.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' })).toEqual({
      ok: false,
      reason: CommandRejection.NoPath,
    });
  });
});
