import { describe, expect, it } from 'vitest';

import { CommandRejection, type Simulation } from '../src/index.ts';
import { entityAt, simulation, tasksFor } from './helpers.ts';

const catalog = [
  {
    id: 'extinguisher',
    name: 'Fire extinguisher',
    capabilities: ['extinguish', 'suppress'],
    agent: 10,
    suppression: 1,
  },
];

function yard(
  input: {
    responders?: { id: string; name: string; position: { x: number; y: number }; speed: number }[];
    equipment?: { id: string; definitionId: string; locationId?: string; ownerId?: string }[];
    agent?: number;
    suppression?: number;
    intensity?: number;
    maxIntensity?: number;
    fuel?: number;
    growth?: number;
    fuelUse?: number;
    range?: number;
    fire?: { x: number; y: number };
    blocked?: { x: number; y: number }[];
    objects?: {
      id: string;
      name: string;
      objectType: 'locker';
      position: { x: number; y: number };
      state: string;
    }[];
  } = {},
): Simulation {
  const responders = input.responders ?? [
    { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 },
    { id: 'b', name: 'B', position: { x: 1, y: 0 }, speed: 20 },
  ];
  const fire = input.fire ?? { x: 4, y: 0 };
  return simulation({
    width: 12,
    height: 12,
    responders,
    memberIds: responders.map((responder) => responder.id),
    blocked: input.blocked,
    objects: input.objects,
    equipmentCatalog: catalog.map((item) => ({
      ...item,
      agent: input.agent ?? item.agent,
      suppression: input.suppression ?? item.suppression,
    })),
    equipment: input.equipment ?? [
      { id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' },
      { id: 'ext-b', definitionId: 'extinguisher', ownerId: 'b' },
    ],
    fires: [
      {
        id: 'fire',
        name: 'Yard fire',
        position: fire,
        intensity: input.intensity ?? 4,
        maxIntensity: input.maxIntensity ?? 8,
        fuel: input.fuel ?? 20,
        growth: input.growth ?? 0,
        fuelUse: input.fuelUse ?? 0,
        range: input.range ?? 1,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Yard fire',
        objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
      },
    ],
  });
}

function until(sim: Simulation, predicate: () => boolean, limit = 400): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  throw new Error('timed out');
}

function fireOf(sim: Simulation) {
  const fire = sim.getSnapshot().fires[0];
  if (!fire) throw new Error('missing fire');
  return fire;
}

function incidentOf(sim: Simulation) {
  const incident = sim.getSnapshot().incidents[0];
  if (!incident) throw new Error('missing incident');
  return incident;
}

describe('fire incidents', () => {
  it('grows a fire without a command and stops when the fuel is gone', () => {
    const growing = yard({ intensity: 1, maxIntensity: 10, fuel: 3, growth: 1, fuelUse: 1 });
    growing.tick();
    growing.tick();
    expect(fireOf(growing).intensity).toBe(3);
    expect(fireOf(growing).fuel).toBe(1);
    growing.tick();
    expect(fireOf(growing).fuel).toBe(0);
    const spent = fireOf(growing).intensity;
    growing.tick();
    expect(fireOf(growing).intensity).toBe(spent);
    expect(incidentOf(growing).state).toBe('active');
  });

  it('freezes fire growth and suppression while paused', () => {
    const sim = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' }],
      intensity: 4,
      suppression: 2,
      growth: 1,
      fuel: 20,
      fuelUse: 1,
    });
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    sim.tick();
    const during = sim.getSnapshot();
    const intensity = fireOf(sim).intensity;
    const agent = during.entities[0]?.inventory[0]?.agent;
    const progress = during.tasks.find((task) => task.kind === 'suppress-fire')?.progressTicks;
    expect(sim.apply({ type: 'pause' })).toEqual({ ok: true });
    sim.tick();
    sim.tick();
    expect(fireOf(sim).intensity).toBe(intensity);
    expect(sim.getSnapshot().entities[0]?.inventory[0]?.agent).toBe(agent);
    expect(
      sim.getSnapshot().tasks.find((task) => task.kind === 'suppress-fire')?.progressTicks,
    ).toBe(progress);
    expect(sim.getSnapshot().tick).toBe(during.tick);
    expect(sim.apply({ type: 'resume' })).toEqual({ ok: true });
    sim.tick();
    expect(fireOf(sim).intensity).toBeLessThan(intensity);
  });

  it('suppresses a fire with carried equipment and resolves the incident', () => {
    const sim = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' }],
    });
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(sim, () => fireOf(sim).out);
    expect(fireOf(sim).intensity).toBe(0);
    expect(entityAt(sim, 'a').inventory[0]?.agent).toBe(6);
    expect(incidentOf(sim).state).toBe('resolved');
    expect(incidentOf(sim).objectives[0]?.state).toBe('satisfied');
    expect(tasksFor(sim, 'a').find((task) => task.kind === 'suppress-fire')?.state).toBe(
      'completed',
    );
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' })).toEqual({
      ok: false,
      reason: CommandRejection.FireOut,
    });
  });

  it('retrieves an extinguisher, moves into range, and then suppresses', () => {
    const sim = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-locker', definitionId: 'extinguisher', locationId: 'locker' }],
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 2, y: 0 },
          state: 'stocked',
        },
      ],
      fire: { x: 8, y: 0 },
    });
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(true);
    expect(sim.getSnapshot().tasks.some((task) => task.kind === 'move')).toBe(true);
    until(sim, () => incidentOf(sim).state === 'resolved');
    expect(entityAt(sim, 'a').inventory[0]?.definitionId).toBe('extinguisher');
    expect(entityAt(sim, 'a').inventory[0]?.agent).toBeLessThan(10);
    expect(sim.getSnapshot().objects[0]?.contents).toHaveLength(0);
  });

  it('rejects suppression without equipment, while aboard, or with no path', () => {
    const empty = yard({ equipment: [] });
    expect(empty.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' })).toEqual({
      ok: false,
      reason: CommandRejection.NoSuppressant,
    });
    expect(empty.getSnapshot().tasks).toHaveLength(0);

    const aboard = simulation({
      width: 12,
      height: 12,
      responders: [
        { id: 'a', name: 'A', position: { x: 1, y: 4 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 2, y: 4 }, speed: 20 },
      ],
      apparatusId: 'engine',
      vehicleCatalog: [
        { id: 'fire_engine_standard', capacity: 4, speed: 40, footprint: { width: 2, height: 1 } },
      ],
      vehicles: [
        {
          id: 'engine',
          name: 'Engine 1',
          definitionId: 'fire_engine_standard',
          nodeId: 'spawn',
          heading: 0,
        },
      ],
      roadNodes: [
        { id: 'spawn', position: { x: 1, y: 4 }, kind: 'spawn' },
        { id: 'east', position: { x: 8, y: 4 }, kind: 'intersection' },
      ],
      roadEdges: [{ from: 'spawn', to: 'east' }],
      equipmentCatalog: catalog,
      equipment: [{ id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' }],
      fires: [
        {
          id: 'fire',
          name: 'Yard fire',
          position: { x: 6, y: 6 },
          intensity: 4,
          maxIntensity: 8,
          fuel: 20,
          growth: 0,
          fuelUse: 0,
          range: 1,
        },
      ],
      incidents: [
        {
          id: 'incident',
          name: 'Yard fire',
          objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
        },
      ],
    });
    expect(aboard.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(aboard, () => entityAt(aboard, 'a').aboardVehicleId === 'engine');
    expect(aboard.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' })).toEqual({
      ok: false,
      reason: CommandRejection.Aboard,
    });

    const blocked = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' }],
      fire: { x: 3, y: 0 },
      range: 0,
      blocked: [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 3, y: 1 },
      ],
    });
    expect(blocked.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' })).toEqual({
      ok: false,
      reason: CommandRejection.NoPath,
    });
  });

  it('releases the equipment reservation when suppression is cancelled', () => {
    const sim = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-locker', definitionId: 'extinguisher', locationId: 'locker' }],
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 2, y: 0 },
          state: 'stocked',
        },
      ],
    });
    sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' });
    const task = sim.getSnapshot().tasks.find((candidate) => candidate.kind === 'suppress-fire');
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(true);
    expect(sim.apply({ type: 'cancel-task', taskId: task?.id ?? '' })).toEqual({ ok: true });
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(false);
    expect(tasksFor(sim, 'a').find((candidate) => candidate.kind === 'suppress-fire')?.state).toBe(
      'cancelled',
    );
  });

  it('fails when the suppression agent runs out and leaves the incident active', () => {
    const sim = yard({
      responders: [{ id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 }],
      equipment: [{ id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' }],
      agent: 2,
      intensity: 4,
    });
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(
      sim,
      () => tasksFor(sim, 'a').find((task) => task.kind === 'suppress-fire')?.state === 'failed',
    );
    expect(tasksFor(sim, 'a').find((task) => task.kind === 'suppress-fire')?.failureReason).toBe(
      CommandRejection.AgentSpent,
    );
    expect(fireOf(sim).intensity).toBe(2);
    expect(entityAt(sim, 'a').inventory[0]?.agent).toBe(0);
    expect(incidentOf(sim).state).toBe('active');
  });

  it('lets a team finish suppression and keeps the objective when one member is overridden', () => {
    const sim = yard({
      responders: [
        { id: 'a', name: 'A', position: { x: 4, y: 1 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 5, y: 0 }, speed: 20 },
      ],
      fire: { x: 4, y: 0 },
    });
    expect(
      sim.apply({ type: 'suppress-incident', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 8 } }).ok,
    ).toBe(true);
    const parent = sim.getSnapshot().tasks.find((task) => task.kind === 'suppress-incident');
    expect(parent?.state).toBe('running');
    expect(tasksFor(sim, 'a').find((task) => task.kind === 'suppress-fire')?.state).toBe(
      'suspended',
    );
    until(sim, () => incidentOf(sim).state === 'resolved');
    expect(sim.getSnapshot().tasks.find((task) => task.id === parent?.id)?.state).toBe('completed');
    expect(
      tasksFor(sim, 'a').some((task) => task.kind === 'move' && task.state === 'running'),
    ).toBe(true);
    expect(tasksFor(sim, 'b').find((task) => task.kind === 'suppress-fire')?.state).toBe(
      'completed',
    );
    expect(
      sim.getSnapshot().objects.every((object) => object.contents.every((item) => !item.reserved)),
    ).toBe(true);
    expect(
      sim
        .getSnapshot()
        .vehicles.every((vehicle) => vehicle.contents.every((item) => !item.reserved)),
    ).toBe(true);
  });

  it('reassigns a reserved extinguisher after an override and still resolves the incident', () => {
    const sim = yard({
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 8 },
        { id: 'b', name: 'B', position: { x: 0, y: 2 }, speed: 20 },
      ],
      equipment: [{ id: 'ext-locker', definitionId: 'extinguisher', locationId: 'locker' }],
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 2, y: 0 },
          state: 'stocked',
        },
      ],
      fire: { x: 6, y: 0 },
      intensity: 2,
    });
    expect(
      sim.apply({ type: 'suppress-incident', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(true);
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 8 } }).ok,
    ).toBe(true);
    until(sim, () => incidentOf(sim).state === 'resolved', 500);
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'suppress-incident')?.state).toBe(
      'completed',
    );
    expect(tasksFor(sim, 'b').find((task) => task.kind === 'suppress-fire')?.state).toBe(
      'completed',
    );
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved ?? false).toBe(false);
    expect(
      tasksFor(sim, 'a').some((task) => task.kind === 'move' && task.state !== 'cancelled'),
    ).toBe(true);
  });

  it('completes a response, disembark, and team suppression with Engine 1', () => {
    const sim = simulation({
      width: 16,
      height: 16,
      responders: [
        { id: 'a', name: 'A', position: { x: 1, y: 4 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 2, y: 4 }, speed: 20 },
      ],
      apparatusId: 'engine',
      vehicleCatalog: [
        { id: 'fire_engine_standard', capacity: 4, speed: 40, footprint: { width: 2, height: 1 } },
      ],
      vehicles: [
        {
          id: 'engine',
          name: 'Engine 1',
          definitionId: 'fire_engine_standard',
          nodeId: 'spawn',
          heading: 0,
        },
      ],
      roadNodes: [
        { id: 'spawn', position: { x: 1, y: 4 }, kind: 'spawn' },
        { id: 'east', position: { x: 8, y: 4 }, kind: 'intersection' },
        { id: 'stage', position: { x: 8, y: 10 }, kind: 'staging' },
      ],
      roadEdges: [
        { from: 'spawn', to: 'east' },
        { from: 'east', to: 'stage' },
      ],
      equipmentCatalog: catalog,
      equipment: [{ id: 'ext-engine', definitionId: 'extinguisher', locationId: 'engine' }],
      fires: [
        {
          id: 'fire',
          name: 'Yard fire',
          position: { x: 8, y: 13 },
          intensity: 2,
          maxIntensity: 4,
          fuel: 40,
          growth: 0,
          fuelUse: 0,
          range: 1,
        },
      ],
      incidents: [
        {
          id: 'incident',
          name: 'Yard fire',
          objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
        },
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
    until(
      sim,
      () =>
        sim.getSnapshot().vehicles[0]?.status === 'idle' &&
        sim.getSnapshot().vehicles[0]?.occupants.length === 0 &&
        sim.getSnapshot().vehicles[0]?.nodeId === 'stage',
      500,
    );
    expect(
      sim.apply({ type: 'suppress-incident', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    until(sim, () => incidentOf(sim).state === 'resolved', 500);
    expect(fireOf(sim).out).toBe(true);
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'suppress-incident')?.state).toBe(
      'completed',
    );
  });
});
