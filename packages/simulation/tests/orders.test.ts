import { describe, expect, it } from 'vitest';

import { restoreSimulation } from '../src/index.ts';

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

describe('group movement and queued orders', () => {
  it('sends a temporary group to distinct nearby tiles', () => {
    const sim = simulation();
    expect(
      sim.apply({ type: 'move-group', responderIds: ['a', 'b'], destination: { x: 6, y: 4 } }),
    ).toEqual({ ok: true });

    const moves = sim
      .getSnapshot()
      .tasks.filter((task) => task.kind === 'move' && task.state === 'running');
    expect(moves).toHaveLength(2);
    expect(moves.every((task) => task.kind === 'move' && task.source === 'individual')).toBe(true);
    const destinations = moves.map((task) => (task.kind === 'move' ? `${task.destination.x},${task.destination.y}` : ''));
    expect(new Set(destinations).size).toBe(2);
    expect(sim.getSnapshot().team.memberIds).toEqual(['a', 'b']);
  });

  it('keeps a queued move until the active move finishes and restores it from a save', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'Hayes', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 3, y: 0 } }).ok).toBe(
      true,
    );
    expect(
      sim.apply({
        type: 'enqueue',
        order: { type: 'move-responder', responderId: 'a', destination: { x: 3, y: 3 } },
      }),
    ).toEqual({ ok: true });

    const snapshot = sim.getSnapshot();
    expect(snapshot.orders).toEqual([
      expect.objectContaining({ assigneeId: 'a', label: 'Move', destination: { x: 3, y: 3 } }),
    ]);
    expect(tasksFor(sim, 'a').find((task) => task.kind === 'move' && task.state === 'running')).toMatchObject({
      destination: { x: 3, y: 0 },
    });

    const restored = restoreSimulation(sim.exportSave());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.simulation.getSnapshot().orders).toHaveLength(1);

    for (let tick = 0; tick < 80; tick += 1) restored.simulation.tick();
    expect(entityAt(restored.simulation, 'a').position).toMatchObject({ x: 3.5, y: 3.5 });
    expect(restored.simulation.getSnapshot().orders).toEqual([]);
  });

  it('does not reserve equipment until a queued retrieval starts', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'Hayes', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
      equipmentCatalog: catalog,
      equipment: [{ id: 'tool', definitionId: 'extinguisher', locationId: 'locker' }],
      objects: [
        {
          id: 'locker',
          name: 'Locker',
          objectType: 'locker',
          position: { x: 4, y: 0 },
          state: 'stocked',
        },
      ],
    });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 0 } });
    sim.apply({
      type: 'enqueue',
      order: {
        type: 'retrieve-equipment',
        responderId: 'a',
        lockerId: 'locker',
        definitionId: 'extinguisher',
      },
    });
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(false);
    sim.tick();
    expect(sim.getSnapshot().objects[0]?.contents[0]?.reserved).toBe(false);

    let sawReservation = false;
    for (let tick = 0; tick < 80; tick += 1) {
      sim.tick();
      if (sim.getSnapshot().objects[0]?.contents.some((item) => item.reserved)) sawReservation = true;
    }
    const carried = sim
      .getSnapshot()
      .entities.some((entity) => entity.inventory.some((item) => item.definitionId === 'extinguisher'));
    expect(sawReservation || carried).toBe(true);
  });

  it('drops an invalid queued move when it becomes executable and warns once', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'Brooks', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
      blocked: [{ x: 4, y: 0 }],
    });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 0 } });
    sim.apply({
      type: 'enqueue',
      order: { type: 'move-responder', responderId: 'a', destination: { x: 4, y: 0 } },
    });
    for (let tick = 0; tick < 40; tick += 1) sim.tick();
    expect(sim.getSnapshot().orders).toEqual([]);
    const warnings = sim.getSnapshot().notices.filter((notice) => notice.tone === 'warning');
    expect(warnings.map((notice) => notice.message)).toContain('Brooks cannot reach the assigned position.');
    expect(warnings.filter((notice) => notice.message.includes('cannot reach'))).toHaveLength(1);
  });

  it('lets a new individual order replace the active task and the queue', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'Hayes', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 4, y: 0 } });
    sim.apply({
      type: 'enqueue',
      order: { type: 'move-responder', responderId: 'a', destination: { x: 4, y: 4 } },
    });
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 3 } }).ok).toBe(
      true,
    );
    const snapshot = sim.getSnapshot();
    expect(snapshot.orders).toEqual([]);
    expect(snapshot.tasks.filter((task) => task.kind === 'move' && task.state === 'running')).toEqual([
      expect.objectContaining({ destination: { x: 0, y: 3 } }),
    ]);
  });

  it('cancels a queued order before it starts', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'Hayes', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 3, y: 0 } });
    sim.apply({
      type: 'enqueue',
      order: { type: 'move-responder', responderId: 'a', destination: { x: 1, y: 3 } },
    });
    const orderId = sim.getSnapshot().orders[0]?.id;
    expect(orderId).toBeTruthy();
    expect(sim.apply({ type: 'cancel-order', orderId: orderId ?? '' })).toEqual({ ok: true });
    expect(sim.getSnapshot().orders).toEqual([]);
    for (let tick = 0; tick < 40; tick += 1) sim.tick();
    expect(entityAt(sim, 'a').position).toMatchObject({ x: 3.5, y: 0.5 });
  });
});
