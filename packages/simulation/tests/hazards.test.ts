import { describe, expect, it } from 'vitest';

import { restoreSimulation, type Simulation } from '../src/index.ts';
import { simulation } from './helpers.ts';

function until(sim: Simulation, predicate: () => boolean, limit = 500): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  expect(predicate()).toBe(true);
}

function cell(sim: Simulation, x: number, y: number) {
  return sim.getSnapshot().hazards.find((hazard) => hazard.x === x && hazard.y === y);
}

function house(input?: {
  intensity?: number;
  growth?: number;
  fuel?: number;
  range?: number;
  door?: 'closed' | 'open';
  responder?: { x: number; y: number };
  equipment?: { id: string; definitionId: string; ownerId?: string; agent?: number }[];
  catalog?: {
    id: string;
    name: string;
    capabilities: string[];
    agent?: number;
    suppression?: number;
  }[];
  suppression?: number;
  agent?: number;
  fires?: {
    id: string;
    name: string;
    position: { x: number; y: number };
    intensity: number;
    maxIntensity: number;
    fuel: number;
    growth: number;
    fuelUse: number;
    range: number;
  }[];
}) {
  const responder = input?.responder ?? { x: 2, y: 0 };
  return simulation({
    width: 8,
    height: 8,
    speed: 20,
    responders: [{ id: 'a', name: 'A', position: responder, speed: 20 }],
    memberIds: ['a'],
    objects: [
      {
        id: 'door-out',
        name: 'Front door',
        objectType: 'door',
        position: { x: 2, y: 1 },
        state: 'closed',
      },
      {
        id: 'door-in',
        name: 'Hall door',
        objectType: 'door',
        position: { x: 2, y: 3 },
        state: input?.door ?? 'closed',
      },
    ],
    equipmentCatalog: input?.catalog ?? [
      {
        id: 'extinguisher',
        name: 'Extinguisher',
        capabilities: ['suppress'],
        agent: input?.agent ?? 40,
        suppression: input?.suppression ?? 1,
      },
      {
        id: 'scba',
        name: 'SCBA',
        capabilities: ['breathing-apparatus'],
        agent: 80,
      },
    ],
    equipment: input?.equipment,
    fires: input?.fires ?? [
      {
        id: 'fire',
        name: 'Room fire',
        position: { x: 2, y: 2 },
        intensity: input?.intensity ?? 4,
        maxIntensity: 8,
        fuel: input?.fuel ?? 40,
        growth: input?.growth ?? 0,
        fuelUse: 0,
        range: input?.range ?? 2,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Room fire',
        objectives: (input?.fires ?? [{ id: 'fire' }]).map((fire) => ({
          id: `objective-${fire.id}`,
          kind: 'suppress-fire' as const,
          targetId: fire.id,
        })),
      },
    ],
    buildings: [
      {
        id: 'house',
        name: 'House',
        floor: {
          id: 'floor',
          name: 'Ground',
          entranceDoorId: 'door-out',
          entry: { x: 2, y: 2 },
          walls: [
            { x: 1, y: 2 },
            { x: 4, y: 2 },
            { x: 1, y: 4 },
            { x: 4, y: 4 },
            { x: 3, y: 3 },
            { x: 2, y: 5 },
            { x: 3, y: 5 },
          ],
          rooms: [
            {
              id: 'south',
              name: 'Entry',
              tiles: [
                { x: 2, y: 2 },
                { x: 3, y: 2 },
              ],
              entrance: { x: 2, y: 2 },
              searchTiles: [{ x: 3, y: 2 }],
              discoveries: [],
            },
            {
              id: 'north',
              name: 'North',
              tiles: [
                { x: 2, y: 4 },
                { x: 3, y: 4 },
              ],
              entrance: { x: 2, y: 4 },
              searchTiles: [{ x: 3, y: 4 }],
              discoveries: [],
            },
          ],
        },
      },
    ],
  });
}

describe('hazard grid', () => {
  it('tracks ignition and grows into a combustible neighbor', () => {
    const sim = house();
    sim.tick();
    expect(cell(sim, 2, 2)?.combustion).toBeCloseTo(0.5);
    until(sim, () => (cell(sim, 3, 2)?.combustion ?? 0) > 0.15, 200);
    expect(cell(sim, 3, 4)?.combustion ?? 0).toBe(0);
    expect(cell(sim, 2, 4)?.combustion ?? 0).toBe(0);
  });

  it('keeps smoke in a closed compartment and lets it through an open door', () => {
    const closed = house();
    for (let tick = 0; tick < 80; tick += 1) closed.tick();
    expect(cell(closed, 2, 2)?.smoke ?? 0).toBeGreaterThan(0.2);
    expect(cell(closed, 2, 4)?.smoke ?? 0).toBeLessThan(0.05);

    const open = house({ door: 'open' });
    until(open, () => (cell(open, 2, 4)?.smoke ?? 0) > 0.05, 200);
  });

  it('raises exposure without breathing apparatus and spends air with it', () => {
    const bare = house({ responder: { x: 2, y: 2 } });
    for (let tick = 0; tick < 20; tick += 1) bare.tick();
    const bareExposure = bare.getSnapshot().exposure.find((entry) => entry.responderId === 'a');
    expect(bareExposure?.exposure ?? 0).toBeGreaterThan(0.3);
    expect(bare.getSnapshot().notices.some((notice) => notice.message.includes('hazardous'))).toBe(
      true,
    );

    const packed = house({
      responder: { x: 2, y: 2 },
      equipment: [{ id: 'pack', definitionId: 'scba', ownerId: 'a' }],
    });
    for (let tick = 0; tick < 20; tick += 1) packed.tick();
    const pack = packed.getSnapshot().exposure.find((entry) => entry.responderId === 'a');
    expect(pack?.air).toBe(60);
    expect(pack?.exposure ?? 0).toBeLessThan(0.05);
  });

  it('withdraws a responder at critical exposure', () => {
    const sim = house({ responder: { x: 2, y: 2 } });
    until(
      sim,
      () => sim.getSnapshot().notices.some((notice) => notice.message.includes('withdrawing')),
      80,
    );
    const move = sim.getSnapshot().tasks.find((task) => task.kind === 'move' && task.state === 'running');
    expect(move && 'destination' in move ? move.destination : null).not.toEqual({ x: 2, y: 2 });
  });

  it('cools spread with water and holds the incident until every cell is out', () => {
    const sim = house({
      fuel: 80,
      suppression: 4,
      equipment: [{ id: 'ext', definitionId: 'extinguisher', ownerId: 'a' }],
    });
    until(sim, () => (cell(sim, 3, 2)?.combustion ?? 0) > 0.35, 300);
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().fires[0]?.intensity === 0, 20);
    expect(sim.getSnapshot().incidents[0]?.state).toBe('active');
    expect(cell(sim, 3, 2)?.combustion ?? 0).toBeGreaterThan(0.05);
    const before = cell(sim, 3, 2)?.combustion ?? 0;
    sim.tick();
    expect(cell(sim, 3, 2)?.combustion ?? 0).toBeLessThan(before);
    until(sim, () => sim.getSnapshot().incidents[0]?.state === 'resolved', 400);
    expect(sim.getSnapshot().fires[0]?.out).toBe(true);
    expect(sim.getSnapshot().hazards.every((hazard) => hazard.combustion <= 0.05)).toBe(true);
  });

  it('resolves only after every burning location is controlled', () => {
    const sim = house({
      fires: [
        {
          id: 'fire-a',
          name: 'A',
          position: { x: 0, y: 0 },
          intensity: 1,
          maxIntensity: 1,
          fuel: 10,
          growth: 0,
          fuelUse: 0,
          range: 1,
        },
        {
          id: 'fire-b',
          name: 'B',
          position: { x: 0, y: 7 },
          intensity: 1,
          maxIntensity: 1,
          fuel: 10,
          growth: 0,
          fuelUse: 0,
          range: 1,
        },
      ],
      responder: { x: 1, y: 0 },
      equipment: [
        { id: 'ext-a', definitionId: 'extinguisher', ownerId: 'a' },
      ],
      catalog: [
        {
          id: 'extinguisher',
          name: 'Extinguisher',
          capabilities: ['suppress'],
          agent: 5,
          suppression: 1,
        },
      ],
    });
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire-a' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().fires.find((fire) => fire.id === 'fire-a')?.out === true, 30);
    expect(sim.getSnapshot().incidents[0]?.state).toBe('active');
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire-b' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().incidents[0]?.state === 'resolved', 80);
  });

  it('freezes hazards while paused and continues deterministically after save and load', () => {
    const first = house();
    const second = house();
    for (let tick = 0; tick < 40; tick += 1) {
      first.tick();
      second.tick();
    }
    expect(first.getSnapshot().hazards).toEqual(second.getSnapshot().hazards);

    const paused = first.getSnapshot().hazards;
    expect(first.apply({ type: 'pause' }).ok).toBe(true);
    first.tick();
    first.tick();
    expect(first.getSnapshot().hazards).toEqual(paused);
    expect(first.getSnapshot().tick).toBe(40);

    const saved = first.exportSave();
    const restored = restoreSimulation(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.simulation.getSnapshot().hazards).toEqual(paused);
    expect(restored.simulation.apply({ type: 'resume' }).ok).toBe(true);
    expect(first.apply({ type: 'resume' }).ok).toBe(true);
    for (let tick = 0; tick < 15; tick += 1) {
      first.tick();
      restored.simulation.tick();
      second.tick();
    }
    expect(restored.simulation.getSnapshot().hazards).toEqual(first.getSnapshot().hazards);
    expect(restored.simulation.getSnapshot().hazards).toEqual(second.getSnapshot().hazards);
    expect(restored.simulation.getSnapshot().tick).toBe(first.getSnapshot().tick);
  });
});
