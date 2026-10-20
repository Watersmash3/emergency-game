import { describe, expect, it } from 'vitest';

import { planRoute, workPosition } from '../src/navigation/routes.ts';
import { restoreSimulation, type Simulation } from '../src/index.ts';
import { simulation } from './helpers.ts';

function until(sim: Simulation, predicate: () => boolean, limit = 1200): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  expect(predicate()).toBe(true);
}

function yard(): Simulation {
  return simulation({
    width: 12,
    height: 8,
    responders: [
      { id: 'a', name: 'A', position: { x: 1, y: 1 }, speed: 20 },
      { id: 'b', name: 'B', position: { x: 2, y: 1 }, speed: 20 },
    ],
    memberIds: ['a', 'b'],
    apparatusId: 'engine',
    roadNodes: [
      { id: 'spawn', position: { x: 1, y: 1 }, kind: 'spawn' },
      { id: 'stage', position: { x: 8, y: 1 }, kind: 'staging' },
    ],
    roadEdges: [{ from: 'spawn', to: 'stage' }],
    vehicleCatalog: [
      {
        id: 'fire_engine_standard',
        capacity: 4,
        speed: 12,
        footprint: { width: 2, height: 1 },
        pump: { tankCapacity: 20, maxDelivery: 1 },
      },
    ],
    vehicles: [
      { id: 'engine', name: 'Engine 1', definitionId: 'fire_engine_standard', nodeId: 'spawn', heading: 0 },
    ],
    equipmentCatalog: [
      { id: 'attack-hose', name: 'Attack hose', capabilities: ['attack', 'suppress'], suppression: 0.2, maxLength: 10 },
    ],
    equipment: [{ id: 'attack', definitionId: 'attack-hose', locationId: 'engine' }],
    fires: [
      {
        id: 'fire',
        name: 'Fire',
        position: { x: 6, y: 4 },
        intensity: 1,
        maxIntensity: 1,
        fuel: 20,
        growth: 0,
        fuelUse: 0,
        range: 2,
      },
    ],
    incidents: [
      {
        id: 'incident',
        name: 'Yard fire',
        objectives: [{ id: 'objective', kind: 'suppress-fire', targetId: 'fire' }],
      },
    ],
    pathways: [
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ],
  });
}

describe('tactical command', () => {
  it('prefers a pathway and refuses a route through a wall', () => {
    const routed = simulation({
      width: 4,
      height: 3,
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 },
        { id: 'b', name: 'B', position: { x: 0, y: 2 }, speed: 4 },
      ],
      memberIds: ['a', 'b'],
      pathways: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      blocked: [{ x: 1, y: 0 }],
    });
    const open = planRoute(worldOf(routed), { x: 0, y: 0 }, { x: 2, y: 1 }, 'direct');
    expect(open?.tiles.some((tile) => tile.x === 1 && tile.y === 1)).toBe(true);
    expect(open?.tiles.some((tile) => tile.x === 1 && tile.y === 0)).toBe(false);
  });

  it('records a closed door and leaves a locked door closed', () => {
    const closed = simulation({
      width: 5,
      height: 1,
      objects: [{ id: 'door', name: 'Door', objectType: 'door', position: { x: 2, y: 0 }, state: 'closed' }],
    });
    expect(planRoute(worldOf(closed), { x: 1, y: 0 }, { x: 3, y: 0 }, 'direct')).toBeNull();
    const entry = planRoute(worldOf(closed), { x: 1, y: 0 }, { x: 3, y: 0 }, 'tactical-entry');
    expect(entry?.doors).toEqual([{ id: 'door', force: false }]);

    const locked = simulation({
      width: 5,
      height: 1,
      objects: [{ id: 'locked', name: 'Locked', objectType: 'door', position: { x: 2, y: 0 }, state: 'locked' }],
    });
    expect(planRoute(worldOf(locked), { x: 1, y: 0 }, { x: 3, y: 0 }, 'tactical-entry')).toBeNull();
    expect(planRoute(worldOf(locked), { x: 1, y: 0 }, { x: 3, y: 0 }, 'tactical-entry', true)?.doors).toEqual([
      { id: 'locked', force: true },
    ]);
  });

  it('walks around severe smoke when another route exists', () => {
    const sim = simulation({
      width: 4,
      height: 3,
      fires: [
        {
          id: 'fire',
          name: 'Fire',
          position: { x: 1, y: 0 },
          intensity: 8,
          maxIntensity: 8,
          fuel: 40,
          growth: 0,
          fuelUse: 0,
          range: 1,
        },
      ],
    });
    for (let tick = 0; tick < 5; tick += 1) sim.tick();
    const smoky = planRoute(worldOf(sim), { x: 0, y: 0 }, { x: 2, y: 0 }, 'avoid-hazard');
    expect(smoky?.tiles.some((tile) => tile.y === 1)).toBe(true);
    const direct = planRoute(worldOf(sim), { x: 0, y: 0 }, { x: 2, y: 0 }, 'direct');
    expect(direct?.tiles.some((tile) => tile.x === 1 && tile.y === 0)).toBe(true);
  });

  it('gives a group distinct tiles and keeps a reserved tile', () => {
    const sim = yard();
    expect(sim.apply({ type: 'move-group', responderIds: ['a', 'b'], destination: { x: 5, y: 3 } }).ok).toBe(true);
    const moves = sim.getSnapshot().tasks.filter((task) => task.kind === 'move');
    expect(moves).toHaveLength(2);
    const destinations = moves.map((task) => (task.kind === 'move' ? `${task.destination.x},${task.destination.y}` : ''));
    expect(new Set(destinations).size).toBe(2);
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 6, y: 3 } }).ok).toBe(true);
  });

  it('responds, attacks, detaches, withdraws, and restores the plan', () => {
    const sim = yard();
    expect(sim.apply({ type: 'respond-to-incident', teamId: 'engine-1', incidentId: 'incident' }).ok).toBe(true);
    expect(sim.getSnapshot().command.plans[0]?.phase).toBe('responding');
    until(sim, () => {
      const vehicle = sim.getSnapshot().vehicles[0];
      return vehicle?.nodeId === 'stage' && vehicle.occupants.length === 0 && vehicle.status === 'idle';
    });
    expect(sim.getSnapshot().command.plans[0]?.phase).toBe('idle');
    expect(sim.apply({ type: 'suppress-structure-fire', teamId: 'engine-1', incidentId: 'incident' }).ok).toBe(true);
    expect(sim.getSnapshot().tasks.some((task) => task.kind === 'establish-fire-attack')).toBe(true);
    expect(sim.getSnapshot().command.plans[0]?.strategy).toBe('offensive');
    expect(sim.apply({ type: 'detach-responder', responderId: 'b' }).ok).toBe(true);
    expect(sim.getSnapshot().command.assignments.find((item) => item.responderId === 'b')?.detachment).toBe(
      'permanent',
    );
    expect(sim.apply({ type: 'search-room', responderId: 'a', roomId: 'missing' }).ok).toBe(false);
    expect(sim.getSnapshot().tasks.some((task) => task.kind === 'establish-fire-attack' && task.state === 'running')).toBe(
      true,
    );
    expect(sim.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'defensive' }).ok).toBe(true);
    expect(sim.apply({ type: 'withdraw-team', teamId: 'engine-1' }).ok).toBe(true);
    expect(sim.getSnapshot().command.plans[0]?.phase).toBe('withdrawing');
    sim.apply({ type: 'pause' });
    const paused = sim.getSnapshot().tick;
    sim.tick();
    expect(sim.getSnapshot().tick).toBe(paused);
    sim.apply({ type: 'resume' });
    const saved = sim.exportSave();
    const restored = restoreSimulation(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.simulation.getSnapshot().command.plans[0]?.strategy).toBe('defensive');
    expect(restored.simulation.getSnapshot().command.detached).toEqual(['b']);
    const again = yard();
    again.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'containment' });
    const twin = yard();
    twin.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'containment' });
    expect(again.getSnapshot().command).toEqual(twin.getSnapshot().command);
  });

  it('selects a nozzle tile inside reach and stays fast on a small map', () => {
    const sim = yard();
    const position = workPosition(worldOf(sim), { x: 1, y: 1 }, 'nozzle', {
      x: 6,
      y: 4,
      range: 2,
      anchor: { x: 1, y: 1 },
      maxLength: 10,
    });
    expect(position.tile).toBeTruthy();
    const started = Date.now();
    const world = worldOf(sim);
    for (let index = 0; index < 40; index += 1) planRoute(world, { x: 0, y: 0 }, { x: 11, y: 7 }, 'avoid-hazard');
    expect(Date.now() - started).toBeLessThan(500);
  });
});

function worldOf(sim: Simulation): Parameters<typeof planRoute>[0] {
  return (sim as unknown as { world: Parameters<typeof planRoute>[0] }).world;
}
