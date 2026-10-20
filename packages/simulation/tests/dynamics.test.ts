import { describe, expect, it } from 'vitest';

import { waterProfile } from '../src/systems/hazardSystem.ts';
import { CommandRejection, restoreSimulation, type Simulation } from '../src/index.ts';
import { simulation } from './helpers.ts';

function until(sim: Simulation, predicate: () => boolean, limit = 800): number {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return tick;
    sim.tick();
  }
  expect(predicate()).toBe(true);
  return limit;
}

function cell(sim: Simulation, x: number, y: number) {
  return sim.getSnapshot().hazards.find((hazard) => hazard.x === x && hazard.y === y);
}

function room(sim: Simulation, id: string) {
  const found = sim.getSnapshot().rooms.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing room ${id}`);
  return found;
}

function finiteHazards(sim: Simulation): void {
  for (const hazard of sim.getSnapshot().hazards) {
    expect(Number.isFinite(hazard.temperature)).toBe(true);
    expect(Number.isFinite(hazard.fuel)).toBe(true);
    expect(Number.isFinite(hazard.combustion)).toBe(true);
    expect(Number.isFinite(hazard.smoke)).toBe(true);
    expect(Number.isFinite(hazard.water)).toBe(true);
    expect(hazard.fuel).toBeGreaterThanOrEqual(0);
    expect(hazard.combustion).toBeGreaterThanOrEqual(0);
    expect(hazard.combustion).toBeLessThanOrEqual(1);
  }
  for (const entry of sim.getSnapshot().rooms) {
    expect(entry.oxygen).toBeGreaterThanOrEqual(0.08);
    expect(entry.oxygen).toBeLessThanOrEqual(1);
    expect(Number.isFinite(entry.upperTemp)).toBe(true);
    expect(entry.smoke).toBeGreaterThanOrEqual(0);
    expect(entry.smoke).toBeLessThanOrEqual(1);
  }
}

function compartment(input?: {
  intensity?: number;
  maxIntensity?: number;
  fuel?: number;
  door?: 'closed' | 'open';
  window?: 'closed' | 'open';
  materialId?: string;
  extraTile?: { x: number; y: number };
  objectives?: { id: string; kind: 'suppress-fire' | 'overhaul-room'; targetId: string }[];
  responder?: { x: number; y: number };
  suppression?: number;
}) {
  const tiles = [
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    ...(input?.extraTile ? [input.extraTile] : []),
  ];
  return simulation({
    width: 8,
    height: 8,
    speed: 20,
    responders: [{ id: 'a', name: 'A', position: input?.responder ?? { x: 0, y: 0 }, speed: 20 }],
    memberIds: ['a'],
    objects: [
      {
        id: 'door-out',
        name: 'Front door',
        objectType: 'door',
        position: { x: 2, y: 1 },
        state: input?.door ?? 'closed',
      },
      {
        id: 'window-side',
        name: 'Side window',
        objectType: 'window',
        position: { x: 1, y: 2 },
        state: input?.window ?? 'closed',
      },
    ],
    equipmentCatalog: [
      {
        id: 'extinguisher',
        name: 'Extinguisher',
        capabilities: ['suppress'],
        agent: 80,
        suppression: input?.suppression ?? 1,
      },
      {
        id: 'scba',
        name: 'SCBA',
        capabilities: ['breathing-apparatus'],
        agent: 8,
      },
    ],
    equipment: [{ id: 'ext', definitionId: 'extinguisher', ownerId: 'a' }],
    furnishings: input?.materialId
      ? [{ id: 'furnishing', name: 'Fuel', position: { x: 3, y: 2 }, materialId: input.materialId }]
      : [],
    fires: [
      {
        id: 'fire',
        name: 'Room fire',
        position: { x: 2, y: 2 },
        intensity: input?.intensity ?? 8,
        maxIntensity: input?.maxIntensity ?? 8,
        fuel: input?.fuel ?? 400,
        growth: 0,
        fuelUse: 0,
        range: 2,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Room fire',
        objectives: input?.objectives ?? [
          { id: 'objective-suppress', kind: 'suppress-fire', targetId: 'fire' },
        ],
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
            { x: 2, y: 3 },
          ],
          rooms: [
            {
              id: 'entry',
              name: 'Entry',
              tiles,
              entrance: { x: 2, y: 2 },
              searchTiles: [{ x: 3, y: 2 }],
              discoveries: [],
            },
          ],
        },
      },
    ],
  });
}

describe('structural fire dynamics', () => {
  it('ignites upholstery sooner than wood and lets light fuel burn out', () => {
    const wood = compartment();
    const cloth = compartment({ materialId: 'upholstery' });
    const woodTicks = until(wood, () => (cell(wood, 3, 2)?.combustion ?? 0) > 0.05);
    const clothTicks = until(cloth, () => (cell(cloth, 3, 2)?.combustion ?? 0) > 0.05);
    expect(clothTicks).toBeLessThan(woodTicks);
    expect(cell(wood, 3, 2)?.temperature ?? 0).toBeGreaterThan(20);

    const tinder = compartment({ materialId: 'tinder' });
    until(tinder, () => (cell(tinder, 3, 2)?.combustion ?? 0) > 0.2);
    until(tinder, () => (cell(tinder, 3, 2)?.fuel ?? 1) === 0, 400);
    until(tinder, () => (cell(tinder, 3, 2)?.combustion ?? 1) <= 0.05, 200);
    expect(cell(tinder, 2, 2)?.combustion ?? 0).toBeGreaterThan(0.5);
  });

  it('heats a neighbor before it burns and accumulates smoke in the compartment', () => {
    const sim = compartment({ intensity: 4, maxIntensity: 8 });
    until(sim, () => (cell(sim, 3, 2)?.temperature ?? 0) > 30);
    expect(cell(sim, 3, 2)?.combustion ?? 0).toBe(0);
    until(sim, () => room(sim, 'entry').smoke > 0.05, 120);
    expect(room(sim, 'entry').upperTemp).toBeGreaterThan(room(sim, 'entry').lowerTemp);
  });

  it('becomes ventilation-limited in a closed room and recovers air through an opening', () => {
    const closed = compartment();
    until(closed, () => closed.getSnapshot().notices.some((notice) => notice.message.includes('ventilation-limited')), 700);
    const starved = room(closed, 'entry').oxygen;
    expect(starved).toBeLessThan(0.35);

    const vented = compartment({ door: 'open' });
    for (let tick = 0; tick < 700; tick += 1) vented.tick();
    expect(room(vented, 'entry').oxygen).toBeGreaterThan(starved);

    const windowed = compartment();
    until(windowed, () => room(windowed, 'entry').oxygen < 0.5, 400);
    const before = room(windowed, 'entry').oxygen;
    expect(windowed.apply({ type: 'ventilate', responderId: 'a', openingId: 'window-side' }).ok).toBe(true);
    until(windowed, () => windowed.getSnapshot().objects.find((object) => object.id === 'window-side')?.state === 'open');
    for (let tick = 0; tick < 40; tick += 1) windowed.tick();
    expect(room(windowed, 'entry').oxygen).toBeGreaterThan(before);
    expect(windowed.apply({ type: 'ventilate', responderId: 'a', openingId: 'window-side' })).toEqual({
      ok: false,
      reason: CommandRejection.OpeningOpen,
    });
  });

  it('flashes a hot compartment once and can rekindle a hot unburned material', () => {
    const sim = compartment({ extraTile: { x: 4, y: 4 } });
    until(sim, () => sim.getSnapshot().notices.some((notice) => notice.message.includes('lights up')), 500);
    expect(room(sim, 'entry').overhauled).toBe(false);
    const flashed = sim.getSnapshot().notices.filter((notice) => notice.message.includes('lights up'));
    for (let tick = 0; tick < 30; tick += 1) sim.tick();
    expect(sim.getSnapshot().notices.filter((notice) => notice.message.includes('lights up'))).toHaveLength(
      flashed.length,
    );

    const hot = compartment({ intensity: 4, maxIntensity: 8, suppression: 1, responder: { x: 2, y: 0 } });
    until(hot, () => {
      const target = cell(hot, 3, 2);
      return Boolean(target && target.combustion > 0.1 && target.combustion < 0.2 && target.temperature >= 80);
    });
    expect(hot.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(hot, () => (cell(hot, 3, 2)?.water ?? 0) > 0, 30);
    const running = hot.getSnapshot().tasks.find((task) => task.kind === 'suppress-fire' && task.state === 'running');
    if (running) hot.apply({ type: 'cancel-task', taskId: running.id });
    const low = cell(hot, 3, 2)?.combustion ?? 1;
    expect(low).toBeLessThanOrEqual(0.2);
    expect(cell(hot, 3, 2)?.water ?? 1).toBeLessThan(0.2);
    until(hot, () => (cell(hot, 3, 2)?.combustion ?? 0) > low + 0.02, 250);
  });

  it('cools and wets with an extinguisher, and a stream cools harder per unit', () => {
    const spray = waterProfile('spray', 1, 1);
    const stream = waterProfile('stream', 1, 1);
    expect(stream.cooling).toBeGreaterThan(spray.cooling);
    expect(stream.steam).toBeGreaterThan(spray.steam);
    expect(spray.combustion).toBeGreaterThan(stream.combustion);

    const sim = compartment({ responder: { x: 2, y: 0 } });
    until(sim, () => (cell(sim, 2, 2)?.temperature ?? 0) > 100);
    const before = cell(sim, 2, 2)?.temperature ?? 0;
    expect(sim.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(sim, () => (cell(sim, 2, 2)?.water ?? 0) > 0.2, 40);
    expect(cell(sim, 2, 2)?.temperature ?? before).toBeLessThan(before);
    expect(cell(sim, 2, 2)?.steam ?? 0).toBeGreaterThan(0);
    expect(['growing', 'steady', 'dying']).toContain(sim.getSnapshot().incidents[0]?.trend);
  });

  it('fails a heated wall, opens that tile to movement, and can fail a door', () => {
    const sim = compartment();
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 3 } })).toEqual({
      ok: false,
      reason: CommandRejection.Blocked,
    });
    until(sim, () => sim.getSnapshot().damage.some((item) => item.x === 2 && item.y === 3 && item.failed), 500);
    expect(sim.getSnapshot().notices.some((notice) => notice.message.includes('wall section fails'))).toBe(true);
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 3 } }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-out')?.state === 'forced', 500);
  });

  it('resolves knockdown without overhaul, then clears a hotspot when overhaul is required', () => {
    const training = compartment({ suppression: 6, responder: { x: 2, y: 0 } });
    until(training, () => (cell(training, 3, 2)?.combustion ?? 0) > 0.1, 300);
    expect(training.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(training, () => training.getSnapshot().incidents[0]?.state === 'resolved', 500);
    expect(training.getSnapshot().incidents[0]?.phase).toBe('resolved');

    const required = compartment({
      suppression: 6,
      responder: { x: 2, y: 0 },
      objectives: [
        { id: 'objective-suppress', kind: 'suppress-fire', targetId: 'fire' },
        { id: 'objective-overhaul', kind: 'overhaul-room', targetId: 'entry' },
      ],
    });
    expect(required.apply({ type: 'overhaul-room', responderId: 'a', roomId: 'entry' })).toEqual({
      ok: false,
      reason: CommandRejection.NothingToOverhaul,
    });
    until(required, () => required.getSnapshot().notices.some((notice) => notice.message.includes('lights up')), 300);
    expect(required.apply({ type: 'suppress-fire', responderId: 'a', fireId: 'fire' }).ok).toBe(true);
    until(required, () => required.getSnapshot().fires[0]?.out === true, 400);
    expect(required.getSnapshot().incidents[0]?.state).toBe('active');
    expect(required.getSnapshot().incidents[0]?.phase).toBe('knockdown');
    expect(required.apply({ type: 'overhaul-room', responderId: 'a', roomId: 'entry' }).ok).toBe(true);
    until(required, () => room(required, 'entry').overhauled, 200);
    expect(required.getSnapshot().hazards.every((hazard) => !hazard.hotspot)).toBe(true);
    expect(required.getSnapshot().incidents[0]?.state).toBe('resolved');
  });

  it('spends SCBA air, withdraws on an empty cylinder, and freezes while paused', () => {
    const packed = simulation({
      width: 8,
      height: 8,
      responders: [{ id: 'a', name: 'A', position: { x: 2, y: 2 }, speed: 20 }],
      memberIds: ['a'],
      equipmentCatalog: [
        { id: 'scba', name: 'SCBA', capabilities: ['breathing-apparatus'], agent: 5 },
      ],
      equipment: [{ id: 'pack', definitionId: 'scba', ownerId: 'a' }],
      fires: [
        {
          id: 'fire',
          name: 'Room fire',
          position: { x: 2, y: 2 },
          intensity: 8,
          maxIntensity: 8,
          fuel: 400,
          growth: 0,
          fuelUse: 0,
          range: 2,
        },
      ],
      incidents: [
        {
          id: 'incident',
          name: 'Room fire',
          objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
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
            walls: [],
            rooms: [
              {
                id: 'entry',
                name: 'Entry',
                tiles: [{ x: 2, y: 2 }],
                entrance: { x: 2, y: 2 },
                searchTiles: [{ x: 2, y: 2 }],
                discoveries: [],
              },
            ],
          },
        },
      ],
      objects: [
        {
          id: 'door-out',
          name: 'Front door',
          objectType: 'door',
          position: { x: 2, y: 1 },
          state: 'open',
        },
      ],
    });
    until(packed, () => (packed.getSnapshot().exposure.find((entry) => entry.responderId === 'a')?.air ?? 1) === 0, 20);
    until(packed, () => packed.getSnapshot().notices.some((notice) => notice.message.includes('withdrawing')), 20);

    const moving = compartment();
    moving.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 2 } });
    moving.tick();
    moving.apply({ type: 'pause' });
    const paused = moving.getSnapshot();
    moving.tick();
    expect(moving.getSnapshot().tick).toBe(paused.tick);
    expect(cell(moving, 2, 2)?.combustion).toBe(cellFrom(paused, 2, 2)?.combustion);
    moving.apply({ type: 'resume' });
    moving.tick();
    expect(moving.getSnapshot().tick).toBe(paused.tick + 1);
  });

  it('saves and continues deterministically', () => {
    const left = compartment({ materialId: 'upholstery' });
    const right = compartment({ materialId: 'upholstery' });
    for (let tick = 0; tick < 25; tick += 1) {
      left.tick();
      right.tick();
    }
    expect(left.getSnapshot().hazards).toEqual(right.getSnapshot().hazards);
    const saved = left.exportSave();
    const restored = restoreSimulation(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    left.tick();
    restored.simulation.tick();
    expect(restored.simulation.getSnapshot().hazards).toEqual(left.getSnapshot().hazards);
    expect(restored.simulation.getSnapshot().rooms).toEqual(left.getSnapshot().rooms);
    finiteHazards(restored.simulation);
  });

  it('advances several burning rooms without unbounded values', () => {
    const rooms = [2, 4, 6, 8].map((y, index) => ({
      id: `room-${index}`,
      name: `Room ${index}`,
      tiles: [
        { x: 2, y },
        { x: 3, y },
      ],
      entrance: { x: 2, y },
      searchTiles: [{ x: 3, y }],
      discoveries: [],
    }));
    const sim = simulation({
      width: 10,
      height: 10,
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
      fires: rooms.map((entry, index) => ({
        id: `fire-${index}`,
        name: entry.name,
        position: entry.entrance,
        intensity: 6,
        maxIntensity: 8,
        fuel: 200,
        growth: 0.01,
        fuelUse: 0.01,
        range: 1,
      })),
      incidents: [
        {
          id: 'incident',
          name: 'Multi-room',
          objectives: rooms.map((entry, index) => ({
            id: `objective-${index}`,
            kind: 'suppress-fire' as const,
            targetId: `fire-${index}`,
          })),
        },
      ],
      buildings: [
        {
          id: 'block',
          name: 'Block',
          floor: {
            id: 'floor',
            name: 'Ground',
            entranceDoorId: 'door-0',
            entry: { x: 2, y: 2 },
            walls: [{ x: 4, y: 2 }],
            rooms,
          },
        },
      ],
      objects: [
        {
          id: 'door-0',
          name: 'Door',
          objectType: 'door',
          position: { x: 2, y: 1 },
          state: 'closed',
        },
      ],
    });
    const started = Date.now();
    for (let tick = 0; tick < 400; tick += 1) sim.tick();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    expect(sim.getSnapshot().hazards.filter((hazard) => hazard.combustion > 0.05).length).toBeGreaterThan(4);
    finiteHazards(sim);
    expect(['developing', 'contained']).toContain(sim.getSnapshot().incidents[0]?.phase);
    console.info(`four-room benchmark: 400 ticks in ${elapsed}ms`);
  });
});

function cellFrom(snapshot: ReturnType<Simulation['getSnapshot']>, x: number, y: number) {
  return snapshot.hazards.find((hazard) => hazard.x === x && hazard.y === y);
}
