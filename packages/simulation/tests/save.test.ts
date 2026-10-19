import { saveDocumentSchema } from '@emergency/protocol';
import { describe, expect, it } from 'vitest';

import { CommandRejection, createRng, restoreSimulation, type Simulation } from '../src/index.ts';
import { simulation } from './helpers.ts';

function ticks(sim: Simulation, count: number): void {
  for (let index = 0; index < count; index += 1) sim.tick();
}

function mustRestore(input: unknown): Simulation {
  const restored = restoreSimulation(input);
  if (!restored.ok) throw new Error(restored.message);
  return restored.simulation;
}

function fork(sim: Simulation): Simulation {
  const saved = sim.exportSave();
  const cloned = JSON.parse(JSON.stringify(saved)) as unknown;
  expect(saveDocumentSchema.parse(cloned)).toEqual(saved);
  const restored = mustRestore(cloned);
  expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
  expect(restored.exportSave()).toEqual(saved);
  return restored;
}

function expectSameContinuation(sim: Simulation, count: number): void {
  const restored = fork(sim);
  ticks(sim, count);
  ticks(restored, count);
  expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
}

function until(sim: Simulation, predicate: () => boolean, limit = 80): void {
  for (let index = 0; index < limit; index += 1) {
    if (predicate()) return;
    sim.tick();
  }
  throw new Error('timed out');
}

const catalog = [
  {
    id: 'extinguisher',
    name: 'Fire extinguisher',
    capabilities: ['extinguish', 'suppress'],
    agent: 10,
    suppression: 1,
  },
];

function fireYard(
  input: {
    growth?: number;
    responders?: { id: string; name: string; position: { x: number; y: number }; speed: number }[];
  } = {},
): Simulation {
  const responders = input.responders ?? [
    { id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 },
    { id: 'b', name: 'B', position: { x: 5, y: 0 }, speed: 20 },
  ];
  return simulation({
    responders,
    memberIds: responders.map((responder) => responder.id),
    equipmentCatalog: catalog,
    equipment: responders.map((responder) => ({
      id: `ext-${responder.id}`,
      definitionId: 'extinguisher',
      ownerId: responder.id,
    })),
    fires: [
      {
        id: 'fire',
        name: 'Yard fire',
        position: { x: 4, y: 0 },
        intensity: 6,
        maxIntensity: 8,
        fuel: 20,
        growth: input.growth ?? 0,
        fuelUse: input.growth ? 1 : 0,
        range: 1,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Yard fire',
        objectives: [{ id: 'objective', kind: 'suppress-fire' as const, targetId: 'fire' }],
      },
    ],
  });
}

function engine(): Simulation {
  return simulation({
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
    ],
    roadEdges: [{ from: 'spawn', to: 'east' }],
  });
}

describe('save and restore', () => {
  it('round-trips a fresh simulation through JSON', () => {
    const sim = fireYard();
    expectSameContinuation(sim, 0);
  });

  it('continues boarding, disembarking, driving, and parking', () => {
    const boarding = engine();
    expect(
      boarding.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' }).ok,
    ).toBe(true);
    until(boarding, () =>
      boarding
        .getSnapshot()
        .tasks.some(
          (task) =>
            task.kind === 'interact' &&
            task.action === 'board' &&
            task.progressTicks > 0 &&
            task.progressTicks < task.durationTicks,
        ),
    );
    expectSameContinuation(boarding, 40);

    const leaving = engine();
    leaving.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(leaving, () =>
      Boolean(leaving.getSnapshot().entities.find((entity) => entity.id === 'a')?.aboardVehicleId),
    );
    expect(leaving.apply({ type: 'exit-vehicle', responderId: 'a', vehicleId: 'engine' }).ok).toBe(
      true,
    );
    until(leaving, () =>
      leaving
        .getSnapshot()
        .tasks.some(
          (task) =>
            task.kind === 'interact' &&
            task.action === 'exit' &&
            task.progressTicks > 0 &&
            task.progressTicks < task.durationTicks,
        ),
    );
    expectSameContinuation(leaving, 40);

    const driving = engine();
    driving.apply({ type: 'board-vehicle', responderId: 'a', vehicleId: 'engine' });
    until(driving, () =>
      Boolean(driving.getSnapshot().entities.find((entity) => entity.id === 'a')?.aboardVehicleId),
    );
    expect(
      driving.apply({ type: 'drive-vehicle', vehicleId: 'engine', destinationNodeId: 'east' }).ok,
    ).toBe(true);
    until(driving, () => driving.getSnapshot().vehicles[0]?.status === 'moving');
    ticks(driving, 1);
    expect(driving.getSnapshot().vehicles[0]?.status).toBe('moving');
    expectSameContinuation(driving, 20);
    expect(driving.getSnapshot().vehicles[0]?.status).toBe('idle');
    expect(driving.getSnapshot().vehicles[0]?.nodeId).toBe('east');
  });

  it('continues equipment retrieval and keeps the reservation', () => {
    const sim = simulation({
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 0, y: 3 }, speed: 20 },
      ],
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 3, y: 0 },
          state: 'stocked',
        },
      ],
      equipmentCatalog: [{ id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] }],
      equipment: [{ id: 'tool', definitionId: 'halligan', locationId: 'locker' }],
    });
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'a',
        lockerId: 'locker',
        definitionId: 'halligan',
      }).ok,
    ).toBe(true);
    until(sim, () => sim.getSnapshot().objects[0]?.contents[0]?.reserved === true);
    const restored = fork(sim);
    const again = {
      type: 'retrieve-equipment' as const,
      responderId: 'b',
      lockerId: 'locker',
      definitionId: 'halligan',
    };
    expect(sim.apply(again)).toEqual({ ok: false, reason: CommandRejection.Reserved });
    expect(restored.apply(again)).toEqual({ ok: false, reason: CommandRejection.Reserved });
    ticks(sim, 40);
    ticks(restored, 40);
    expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
    const carried = sim
      .getSnapshot()
      .entities.flatMap((entity) => entity.inventory.map((item) => item.id));
    expect(carried).toEqual(['tool']);
  });

  it('continues fire growth, suppression, overrides, and a paused incident', () => {
    const growing = fireYard({ growth: 1 });
    ticks(growing, 2);
    expectSameContinuation(growing, 4);

    const suppressing = fireYard({
      responders: [{ id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 }],
    });
    expect(suppressing.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(
      true,
    );
    ticks(suppressing, 2);
    expect(
      suppressing.getSnapshot().tasks.find((task) => task.kind === 'suppress-fire')?.state,
    ).toBe('running');
    expectSameContinuation(suppressing, 10);
    expect(suppressing.getSnapshot().fires[0]?.out).toBe(true);
    expect(suppressing.getSnapshot().incidents[0]?.state).toBe('resolved');

    const crew = fireYard();
    expect(
      crew.apply({ type: 'suppress-incident', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    expect(
      crew.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 8 } }).ok,
    ).toBe(true);
    ticks(crew, 1);
    expect(
      crew
        .getSnapshot()
        .tasks.find((task) => task.assigneeId === 'a' && task.kind === 'suppress-fire')?.state,
    ).toBe('suspended');
    expectSameContinuation(crew, 20);
    expect(crew.getSnapshot().incidents[0]?.state).toBe('resolved');
    expect(
      crew.getSnapshot().tasks.some((task) => task.assigneeId === 'a' && task.kind === 'move'),
    ).toBe(true);

    const paused = fireYard({
      responders: [{ id: 'a', name: 'A', position: { x: 4, y: 0 }, speed: 20 }],
    });
    paused.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' });
    ticks(paused, 1);
    paused.apply({ type: 'pause' });
    const restored = fork(paused);
    const frozen = paused.getSnapshot();
    ticks(paused, 5);
    ticks(restored, 5);
    expect(paused.getSnapshot()).toEqual(frozen);
    expect(restored.getSnapshot()).toEqual(frozen);
    paused.apply({ type: 'resume' });
    restored.apply({ type: 'resume' });
    ticks(paused, 8);
    ticks(restored, 8);
    expect(restored.getSnapshot()).toEqual(paused.getSnapshot());
    expect(paused.getSnapshot().fires[0]?.out).toBe(true);
  });

  it('rejects an incompatible or inconsistent save without changing the source', () => {
    const sim = fireYard();
    sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' });
    const before = sim.getSnapshot();
    const saved = sim.exportSave();

    const version = restoreSimulation({ ...saved, schemaVersion: 2 });
    expect(version.ok).toBe(false);
    if (!version.ok)
      expect(version.message).toBe('This save uses schema version 2 and cannot be loaded.');

    const duplicate = structuredClone(saved);
    const item = duplicate.equipment[0];
    if (!item) throw new Error('missing equipment');
    duplicate.equipment.push({ ...item });
    const duplicated = restoreSimulation(duplicate);
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.message).toContain('duplicated');

    const retrieval = simulation({
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 3, y: 0 },
          state: 'stocked',
        },
      ],
      equipmentCatalog: [{ id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] }],
      equipment: [{ id: 'tool', definitionId: 'halligan', locationId: 'locker' }],
    });
    retrieval.apply({
      type: 'retrieve-equipment',
      responderId: 'a',
      lockerId: 'locker',
      definitionId: 'halligan',
    });
    const orphan = retrieval.exportSave();
    const child = orphan.tasks.find((task) => task.parentId);
    expect(child?.parentId).toBeTruthy();
    orphan.tasks = orphan.tasks.filter((task) => task.id !== child?.parentId);
    const missingParent = restoreSimulation(orphan);
    expect(missingParent.ok).toBe(false);
    if (!missingParent.ok) expect(missingParent.message).toContain('missing task');

    expect(sim.getSnapshot()).toEqual(before);
  });

  it('resumes the random sequence from the saved state', () => {
    const first = createRng(11);
    first.next();
    const state = first.getState();
    const continued = createRng(11, state);
    const fresh = createRng(11);
    fresh.next();
    expect(continued.next()).toBe(fresh.next());
  });
});
