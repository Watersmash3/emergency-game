import { describe, expect, it } from 'vitest';

import { CommandRejection, restoreSimulation, type Simulation } from '../src/index.ts';
import { entityAt, simulation } from './helpers.ts';

const responders = [
  { id: 'a', name: 'A', position: { x: 2, y: 3 }, speed: 40 },
  { id: 'b', name: 'B', position: { x: 3, y: 3 }, speed: 40 },
  { id: 'c', name: 'C', position: { x: 2, y: 4 }, speed: 40 },
  { id: 'd', name: 'D', position: { x: 3, y: 4 }, speed: 40 },
];

function yard(input: { supplyLength?: number; attackLength?: number; tank?: number; hydrantAt?: { x: number; y: number } } = {}): Simulation {
  return simulation({
    width: 14,
    height: 8,
    responders,
    memberIds: responders.map((responder) => responder.id),
    apparatusId: 'engine',
    roadNodes: [{ id: 'spawn', position: { x: 2, y: 2 }, kind: 'spawn' }],
    roadEdges: [],
    vehicleCatalog: [
      {
        id: 'fire_engine_standard',
        capacity: 4,
        speed: 8,
        footprint: { width: 2, height: 1 },
        pump: { tankCapacity: input.tank ?? 20, maxDelivery: 1 },
      },
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
    equipmentCatalog: [
      {
        id: 'supply-hose',
        name: 'Supply hose',
        capabilities: ['supply'],
        maxLength: input.supplyLength ?? 8,
      },
      {
        id: 'attack-hose',
        name: 'Attack hose',
        capabilities: ['attack', 'suppress'],
        suppression: 0.05,
        maxLength: input.attackLength ?? 10,
      },
      {
        id: 'extinguisher',
        name: 'Fire extinguisher',
        capabilities: ['extinguish', 'suppress'],
        agent: 80,
        suppression: 0.02,
      },
    ],
    equipment: [
      { id: 'supply', definitionId: 'supply-hose', locationId: 'engine' },
      { id: 'attack', definitionId: 'attack-hose', locationId: 'engine' },
      { id: 'ext', definitionId: 'extinguisher', locationId: 'engine' },
    ],
    hydrants: [
      {
        id: 'hydrant',
        name: 'Yard hydrant',
        position: input.hydrantAt ?? { x: 5, y: 2 },
        flowCapacity: 1,
      },
    ],
    fires: [
      {
        id: 'fire',
        name: 'Training fire',
        position: { x: 8, y: 2 },
        intensity: 0.4,
        maxIntensity: 1,
        fuel: 100,
        growth: 0,
        fuelUse: 0,
        range: 2,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Training',
        objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
      },
    ],
  });
}

function until(sim: Simulation, predicate: () => boolean, limit = 900): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  throw new Error(`condition not met after ${limit} ticks`);
}

function pumpOf(sim: Simulation) {
  const pump = sim.getSnapshot().vehicles[0]?.pump;
  if (!pump) throw new Error('missing pump');
  return pump;
}

function intensity(sim: Simulation): number {
  return sim.getSnapshot().fires[0]?.intensity ?? -1;
}

function flowing(sim: Simulation): boolean {
  return sim.getSnapshot().hoses.some((hose) => hose.kind === 'attack' && hose.flow > 0);
}

describe('water supply and attack lines', () => {
  it('starts and stops the pump as a task', () => {
    const sim = yard();
    expect(sim.apply({ type: 'start-pump', responderId: 'a', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => pumpOf(sim).state === 'operating');
    expect(pumpOf(sim).pressure).toBe(1);
    expect(sim.apply({ type: 'start-pump', responderId: 'b', vehicleId: 'engine' })).toEqual({
      ok: false,
      reason: CommandRejection.PumpRunning,
    });
    expect(sim.apply({ type: 'stop-pump', responderId: 'b', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => pumpOf(sim).state === 'off');
    expect(pumpOf(sim).pressure).toBe(0);
    expect(sim.apply({ type: 'stop-pump', responderId: 'a', vehicleId: 'engine' })).toEqual({
      ok: false,
      reason: CommandRejection.PumpOff,
    });
  });

  it('consumes tank water and refuses to create water without a source', () => {
    const sim = yard({ tank: 6 });
    expect(sim.apply({ type: 'start-pump', responderId: 'a', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => pumpOf(sim).state === 'operating');
    expect(sim.apply({ type: 'deploy-attack', responderId: 'b', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'attack'));
    const hose = sim.getSnapshot().hoses.find((candidate) => candidate.kind === 'attack');
    expect(hose).toBeTruthy();
    expect(
      sim.apply({
        type: 'operate-nozzle',
        responderId: 'b',
        hoseId: hose?.id ?? '',
        fireId: 'fire',
      }).ok,
    ).toBe(true);
    until(sim, () => flowing(sim));
    const before = pumpOf(sim).tank;
    sim.tick();
    expect(pumpOf(sim).tank).toBeLessThan(before);
    until(sim, () => pumpOf(sim).tank === 0);
    const dry = intensity(sim);
    for (let tick = 0; tick < 5; tick += 1) sim.tick();
    expect(intensity(sim)).toBe(dry);
    expect(sim.getSnapshot().hoses.find((candidate) => candidate.kind === 'attack')?.flow).toBe(0);
  });

  it('replenishes the tank from an open hydrant supply', () => {
    const sim = yard({ tank: 4 });
    expect(
      sim.apply({
        type: 'connect-supply',
        responderId: 'a',
        hydrantId: 'hydrant',
        vehicleId: 'engine',
      }).ok,
    ).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'supply' && hose.targetId === 'engine'));
    const supply = sim.getSnapshot().hoses.find((hose) => hose.kind === 'supply');
    expect(supply?.length).toBeGreaterThan(0);
    expect(supply && supply.length <= supply.maxLength).toBe(true);
    expect(
      sim.apply({ type: 'open-supply', responderId: 'a', hoseId: supply?.id ?? '' }).ok,
    ).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'supply' && hose.state === 'open'));
    expect(sim.apply({ type: 'start-pump', responderId: 'b', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => pumpOf(sim).state === 'operating');
    expect(sim.apply({ type: 'deploy-attack', responderId: 'c', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'attack'));
    const attack = sim.getSnapshot().hoses.find((hose) => hose.kind === 'attack');
    expect(
      sim.apply({
        type: 'operate-nozzle',
        responderId: 'c',
        hoseId: attack?.id ?? '',
        fireId: 'fire',
      }).ok,
    ).toBe(true);
    until(sim, () => flowing(sim));
    for (let tick = 0; tick < 12; tick += 1) sim.tick();
    expect(pumpOf(sim).tank).toBeGreaterThan(0);
    expect(intensity(sim)).toBeLessThan(0.4);
  });

  it('rejects a supply hose that cannot reach and a nozzle move past the attack line', () => {
    const sim = yard({ supplyLength: 2, attackLength: 2 });
    expect(
      sim.apply({
        type: 'connect-supply',
        responderId: 'a',
        hydrantId: 'hydrant',
        vehicleId: 'engine',
      }),
    ).toEqual({ ok: false, reason: CommandRejection.HoseTooShort });
    expect(sim.apply({ type: 'deploy-attack', responderId: 'a', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'attack'));
    const hose = sim.getSnapshot().hoses.find((candidate) => candidate.kind === 'attack');
    expect(
      sim.apply({
        type: 'reposition-nozzle',
        responderId: 'a',
        hoseId: hose?.id ?? '',
        destination: { x: 8, y: 2 },
      }),
    ).toEqual({ ok: false, reason: CommandRejection.HoseTooShort });
    expect(
      sim.apply({
        type: 'reposition-nozzle',
        responderId: 'a',
        hoseId: hose?.id ?? '',
        destination: { x: 3, y: 2 },
      }).ok,
    ).toBe(true);
    until(
      sim,
      () =>
        sim.getSnapshot().tasks.find((task) => task.kind === 'reposition-nozzle')?.state ===
        'completed',
    );
    expect(sim.getSnapshot().hoses[0]?.length).toBeLessThanOrEqual(2);
    expect(Math.floor(entityAt(sim, 'a').position.x)).toBe(3);
  });

  it('disconnects a supply line and returns the equipment', () => {
    const sim = yard();
    expect(
      sim.apply({
        type: 'connect-supply',
        responderId: 'a',
        hydrantId: 'hydrant',
        vehicleId: 'engine',
      }).ok,
    ).toBe(true);
    until(sim, () => Boolean(pumpOf(sim).intakeId));
    const hoseId = pumpOf(sim).intakeId ?? '';
    expect(sim.apply({ type: 'disconnect-supply', responderId: 'b', hoseId }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.length === 0);
    expect(pumpOf(sim).intakeId).toBeNull();
    expect(sim.getSnapshot().vehicles[0]?.contents.some((item) => item.id === 'supply')).toBe(true);
    expect(sim.getSnapshot().hydrants[0]?.connectionId).toBeNull();
  });

  it('cancels a connection in progress without leaving a hose behind', () => {
    const sim = yard();
    expect(
      sim.apply({
        type: 'connect-supply',
        responderId: 'a',
        hydrantId: 'hydrant',
        vehicleId: 'engine',
      }).ok,
    ).toBe(true);
    sim.tick();
    const task = sim.getSnapshot().tasks.find((candidate) => candidate.kind === 'connect-supply');
    expect(task?.state).toBe('running');
    expect(sim.apply({ type: 'cancel-task', taskId: task?.id ?? '' }).ok).toBe(true);
    expect(sim.getSnapshot().hoses).toEqual([]);
    expect(sim.getSnapshot().vehicles[0]?.contents.some((item) => item.id === 'supply')).toBe(true);
    expect(
      sim.getSnapshot().vehicles[0]?.contents.find((item) => item.id === 'supply')?.reserved,
    ).toBe(false);
  });

  it('does not suppress without flow and stops when the pump shuts down', () => {
    const sim = yard();
    expect(sim.apply({ type: 'deploy-attack', responderId: 'a', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().hoses.some((hose) => hose.kind === 'attack'));
    const hose = sim.getSnapshot().hoses.find((candidate) => candidate.kind === 'attack');
    expect(
      sim.apply({
        type: 'operate-nozzle',
        responderId: 'a',
        hoseId: hose?.id ?? '',
        fireId: 'fire',
      }).ok,
    ).toBe(true);
    until(sim, () => entityAt(sim, 'a').position.x >= 6);
    for (let tick = 0; tick < 8; tick += 1) sim.tick();
    expect(intensity(sim)).toBe(0.4);
    expect(sim.apply({ type: 'start-pump', responderId: 'b', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => flowing(sim));
    const wet = intensity(sim);
    expect(wet).toBeLessThan(0.4);
    expect(sim.apply({ type: 'stop-pump', responderId: 'c', vehicleId: 'engine' }).ok).toBe(true);
    until(sim, () => pumpOf(sim).state === 'off');
    const stopped = intensity(sim);
    for (let tick = 0; tick < 6; tick += 1) sim.tick();
    expect(intensity(sim)).toBe(stopped);
  });

  it('keeps extinguisher suppression working beside the hose tools', () => {
    const sim = yard();
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(sim, () => intensity(sim) < 0.4);
    expect(sim.getSnapshot().hoses).toEqual([]);
  });

  it('suspends hose deployment on an individual override without duplicating equipment', () => {
    const sim = yard();
    expect(sim.apply({ type: 'deploy-attack', responderId: 'a', vehicleId: 'engine' }).ok).toBe(true);
    sim.tick();
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 3 } }).ok,
    ).toBe(true);
    const tasks = sim.getSnapshot().tasks;
    expect(
      tasks.filter((task) => task.kind === 'deploy-attack' && task.state === 'cancelled'),
    ).toHaveLength(1);
    expect(sim.getSnapshot().hoses.filter((hose) => hose.kind === 'attack')).toHaveLength(0);
    expect(
      sim.getSnapshot().vehicles[0]?.contents.filter((item) => item.definitionId === 'attack-hose'),
    ).toHaveLength(1);
  });

  it('reassigns a suspended team role and still extinguishes the fire', () => {
    const sim = yard({ tank: 30 });
    expect(
      sim.apply({ type: 'establish-fire-attack', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    sim.tick();
    const supply = sim
      .getSnapshot()
      .tasks.find(
        (task) => 'role' in task && task.role === 'supply' && task.state === 'running',
      );
    expect(supply?.assigneeId).toBeTruthy();
    expect(
      sim.apply({
        type: 'move-responder',
        responderId: supply?.assigneeId ?? '',
        destination: { x: 0, y: 0 },
      }).ok,
    ).toBe(true);
    sim.tick();
    const replacement = sim
      .getSnapshot()
      .tasks.find(
        (task) =>
          'role' in task &&
          task.role === 'supply' &&
          (task.state === 'running' || task.state === 'pending' || task.state === 'ready') &&
          task.assigneeId !== supply?.assigneeId,
      );
    expect(replacement?.assigneeId).toBeTruthy();
    until(sim, () => sim.getSnapshot().incidents[0]?.state === 'resolved', 1600);
    expect(sim.getSnapshot().hoses.filter((hose) => hose.kind === 'attack')).toHaveLength(1);
    expect(sim.getSnapshot().hoses.filter((hose) => hose.kind === 'supply').length).toBeLessThanOrEqual(1);
    const supplyCount =
      (sim.getSnapshot().vehicles[0]?.contents.filter((item) => item.id === 'supply').length ?? 0) +
      sim.getSnapshot().entities.filter((entity) =>
        entity.inventory.some((item) => item.id === 'supply'),
      ).length +
      sim.getSnapshot().hoses.filter((hose) => hose.kind === 'supply').length;
    expect(supplyCount).toBe(1);
  });

  it('pauses water and suppression, then continues deterministically after save and load', () => {
    const sim = yard({ tank: 40 });
    expect(
      sim.apply({ type: 'establish-fire-attack', teamId: 'engine-1', incidentId: 'incident' }).ok,
    ).toBe(true);
    until(sim, () => flowing(sim), 1200);
    expect(sim.apply({ type: 'pause' }).ok).toBe(true);
    const pausedTick = sim.getSnapshot().tick;
    const pausedTank = pumpOf(sim).tank;
    const pausedIntensity = intensity(sim);
    sim.tick();
    sim.step(1000);
    expect(sim.getSnapshot().tick).toBe(pausedTick);
    expect(pumpOf(sim).tank).toBe(pausedTank);
    expect(intensity(sim)).toBe(pausedIntensity);
    expect(sim.apply({ type: 'resume' }).ok).toBe(true);
    const saved = sim.exportSave();
    const restored = restoreSimulation(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    for (let tick = 0; tick < 15; tick += 1) {
      sim.tick();
      restored.simulation.tick();
    }
    expect(restored.simulation.getSnapshot().tick).toBe(sim.getSnapshot().tick);
    expect(restored.simulation.getSnapshot().fires).toEqual(sim.getSnapshot().fires);
    expect(restored.simulation.getSnapshot().hoses).toEqual(sim.getSnapshot().hoses);
    expect(restored.simulation.getSnapshot().vehicles[0]?.pump).toEqual(pumpOf(sim));
    expect(restored.simulation.getSnapshot().hoses.filter((hose) => hose.kind === 'attack')).toHaveLength(1);
  });

  it('migrates a version 1 save without inventing a second hose', () => {
    const sim = yard();
    const saved = sim.exportSave();
    const legacy = structuredClone(saved) as unknown as {
      schemaVersion: number;
      entities: Array<{ vehicle?: Record<string, unknown> }>;
    };
    legacy.schemaVersion = 1;
    for (const entity of legacy.entities) {
      if (entity.vehicle) delete entity.vehicle.pump;
    }
    const restored = restoreSimulation(legacy);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.simulation.getSnapshot().vehicles[0]?.pump).toMatchObject({
      state: 'off',
      tank: 80,
      tankCapacity: 80,
      pressure: 0,
      intakeId: null,
      discharges: [],
    });
    expect(restored.simulation.getSnapshot().hoses).toEqual([]);
    expect(restored.simulation.getSnapshot().hydrants).toHaveLength(1);
  });
});
