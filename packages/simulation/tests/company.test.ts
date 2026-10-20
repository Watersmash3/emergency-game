import { describe, expect, it } from 'vitest';

import { restoreSimulation, type Simulation } from '../src/index.ts';
import { simulation } from './helpers.ts';

function until(sim: Simulation, predicate: () => boolean, limit = 2000): void {
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
        pump: { tankCapacity: 40, maxDelivery: 1 },
      },
    ],
    vehicles: [
      { id: 'engine', name: 'Engine 1', definitionId: 'fire_engine_standard', nodeId: 'spawn', heading: 0 },
    ],
    equipmentCatalog: [
      { id: 'attack-hose', name: 'Attack hose', capabilities: ['attack', 'suppress'], suppression: 1, maxLength: 10 },
    ],
    equipment: [{ id: 'attack', definitionId: 'attack-hose', locationId: 'engine' }],
    fires: [
      {
        id: 'fire',
        name: 'Fire',
        position: { x: 6, y: 4 },
        intensity: 1,
        maxIntensity: 1,
        fuel: 8,
        growth: 0,
        fuelUse: 0.05,
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
  });
}

function order(sim: Simulation, kind = 'control-fire') {
  return sim.getSnapshot().command.orders.find((item) => item.kind === kind);
}

describe('company command', () => {
  it('reports readiness and rejects an unassigned control order', () => {
    const sim = yard();
    expect(sim.getSnapshot().command.company.readiness).toBe('ready');
    expect(sim.getSnapshot().command.company.capabilities).toEqual(['attack', 'pump']);
    expect(sim.apply({ type: 'control-fire', incidentId: 'incident' }).ok).toBe(false);
    expect(sim.apply({ type: 'assign-company', incidentId: 'incident' }).ok).toBe(true);
    expect(sim.getSnapshot().command.company.incidentId).toBe('incident');
  });

  it('runs response and attack from one control-fire order', () => {
    const sim = yard();
    sim.apply({ type: 'assign-company', incidentId: 'incident' });
    sim.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'offensive' });
    expect(sim.apply({ type: 'control-fire', incidentId: 'incident' }).ok).toBe(true);
    expect(order(sim)?.progress).toBe('Responding');
    expect(sim.getSnapshot().tasks.some((task) => task.kind === 'respond')).toBe(true);
    expect(sim.apply({ type: 'control-fire', incidentId: 'incident' }).ok).toBe(true);
    expect(sim.getSnapshot().tasks.filter((task) => task.kind === 'respond')).toHaveLength(1);
    until(sim, () => order(sim)?.progress === 'Attacking');
    expect(sim.getSnapshot().tasks.some((task) => task.kind === 'establish-fire-attack')).toBe(true);
    until(
      sim,
      () =>
        sim
          .getSnapshot()
          .command.assignments.some((item) => item.role === 'pump' || item.role === 'attack' || item.role === 'supply'),
    );
    const roles = new Set(
      sim
        .getSnapshot()
        .command.assignments.map((item) => item.role)
        .filter((role) => role === 'pump' || role === 'attack' || role === 'supply'),
    );
    expect(roles.size).toBeGreaterThan(0);
    const attackId = sim.getSnapshot().tasks.find((task) => task.kind === 'establish-fire-attack')?.id;
    sim.apply({ type: 'detach-responder', responderId: 'b' });
    expect(sim.getSnapshot().tasks.some((task) => task.id === attackId && task.state === 'running')).toBe(true);
    expect(sim.apply({ type: 'rejoin-team', responderId: 'b' }).ok).toBe(true);
    until(sim, () => sim.getSnapshot().incidents[0]?.state === 'resolved', 4000);
    expect(order(sim)?.state).toBe('complete');
    expect(sim.getSnapshot().tasks.filter((task) => task.kind === 'establish-fire-attack')).toHaveLength(1);
  });

  it('holds outside, waits for approval, and stays manual until released', () => {
    const held = yard();
    held.apply({ type: 'assign-company', incidentId: 'incident' });
    held.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'hold' });
    held.apply({ type: 'control-fire', incidentId: 'incident' });
    until(held, () => order(held)?.progress === 'Holding position');
    expect(held.getSnapshot().tasks.some((task) => task.kind === 'establish-fire-attack')).toBe(false);

    const supervised = yard();
    supervised.apply({ type: 'set-autonomy', autonomy: 'supervised' });
    supervised.apply({ type: 'assign-company', incidentId: 'incident' });
    supervised.apply({ type: 'control-fire', incidentId: 'incident' });
    until(supervised, () => order(supervised)?.state === 'awaiting');
    expect(order(supervised)?.decision).toBe('Approve fire attack');
    expect(supervised.getSnapshot().tasks.some((task) => task.kind === 'establish-fire-attack')).toBe(false);
    expect(supervised.apply({ type: 'approve-decision' }).ok).toBe(true);
    until(supervised, () => order(supervised)?.progress === 'Attacking');

    const manual = yard();
    manual.apply({ type: 'set-autonomy', autonomy: 'manual' });
    manual.apply({ type: 'assign-company', incidentId: 'incident' });
    expect(manual.apply({ type: 'control-fire', incidentId: 'incident' }).ok).toBe(true);
    expect(order(manual)?.progress).toBe('Direct control');
    expect(manual.getSnapshot().tasks.some((task) => task.kind === 'respond')).toBe(false);
    manual.apply({ type: 'set-autonomy', autonomy: 'standard' });
    manual.tick();
    expect(manual.getSnapshot().tasks.some((task) => task.kind === 'respond')).toBe(true);
  });

  it('withdraws, cancels, pauses, and restores the order', () => {
    const sim = yard();
    sim.apply({ type: 'assign-company', incidentId: 'incident' });
    sim.apply({ type: 'control-fire', incidentId: 'incident' });
    expect(sim.apply({ type: 'withdraw-team', teamId: 'engine-1' }).ok).toBe(true);
    expect(order(sim, 'control-fire')?.state).toBe('cancelled');
    expect(order(sim, 'withdraw')?.progress).toBe('Withdrawing');

    const cancelled = yard();
    cancelled.apply({ type: 'assign-company', incidentId: 'incident' });
    cancelled.apply({ type: 'control-fire', incidentId: 'incident' });
    expect(cancelled.apply({ type: 'cancel-objective' }).ok).toBe(true);
    expect(order(cancelled)?.state).toBe('cancelled');
    expect(cancelled.getSnapshot().tasks.some((task) => task.kind === 'respond' && task.state === 'running')).toBe(
      false,
    );

    const paused = yard();
    paused.apply({ type: 'assign-company', incidentId: 'incident' });
    paused.apply({ type: 'control-fire', incidentId: 'incident' });
    paused.apply({ type: 'pause' });
    const tick = paused.getSnapshot().tick;
    paused.tick();
    expect(paused.getSnapshot().tick).toBe(tick);
    paused.apply({ type: 'resume' });
    const saved = paused.exportSave();
    const restored = restoreSimulation(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.simulation.getSnapshot().command.company.autonomy).toBe('standard');
    expect(restored.simulation.getSnapshot().command.orders[0]?.kind).toBe('control-fire');
    expect(restored.simulation.getSnapshot().tasks.filter((task) => task.kind === 'respond')).toHaveLength(1);

    const twin = yard();
    twin.apply({ type: 'assign-company', incidentId: 'incident' });
    twin.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'defensive' });
    twin.apply({ type: 'control-fire', incidentId: 'incident' });
    const again = yard();
    again.apply({ type: 'assign-company', incidentId: 'incident' });
    again.apply({ type: 'set-strategy', incidentId: 'incident', strategy: 'defensive' });
    again.apply({ type: 'control-fire', incidentId: 'incident' });
    expect(again.getSnapshot().command.orders).toEqual(twin.getSnapshot().command.orders);
  });
});
