import { describe, expect, it } from 'vitest';

import { CommandRejection, restoreSimulation, type Simulation } from '../src/index.ts';
import { entityAt, simulation } from './helpers.ts';

function until(sim: Simulation, predicate: () => boolean, limit = 500): void {
  for (let tick = 0; tick < limit; tick += 1) {
    if (predicate()) return;
    sim.tick();
  }
  expect(predicate()).toBe(true);
}

function yard(withTool = true) {
  return simulation({
    width: 12,
    height: 12,
    speed: 12,
    responders: [
      { id: 'a', name: 'A', position: { x: 0, y: 2 }, speed: 12 },
      { id: 'b', name: 'B', position: { x: 1, y: 2 }, speed: 12 },
      { id: 'c', name: 'C', position: { x: 2, y: 2 }, speed: 12 },
      { id: 'd', name: 'D', position: { x: 3, y: 2 }, speed: 12 },
    ],
    objects: [
      {
        id: 'door-out',
        name: 'Front door',
        objectType: 'door',
        position: { x: 5, y: 2 },
        state: 'locked',
        requiredCapability: 'force-entry',
      },
      {
        id: 'door-in',
        name: 'Hall door',
        objectType: 'door',
        position: { x: 5, y: 4 },
        state: 'closed',
      },
    ],
    equipmentCatalog: [{ id: 'halligan', name: 'Halligan', capabilities: ['force-entry'] }],
    equipment: withTool ? [{ id: 'tool', definitionId: 'halligan', ownerId: 'a' }] : [],
    buildings: [
      {
        id: 'house',
        name: 'House',
        floor: {
          id: 'floor',
          name: 'Ground',
          entranceDoorId: 'door-out',
          entry: { x: 5, y: 3 },
          walls: [
            { x: 4, y: 2 },
            { x: 6, y: 2 },
            { x: 3, y: 3 },
            { x: 3, y: 4 },
            { x: 3, y: 5 },
            { x: 7, y: 3 },
            { x: 7, y: 4 },
            { x: 7, y: 5 },
            { x: 4, y: 4 },
            { x: 6, y: 4 },
            { x: 4, y: 6 },
            { x: 5, y: 6 },
            { x: 6, y: 6 },
          ],
          rooms: [
            {
              id: 'south',
              name: 'Entry',
              tiles: [
                { x: 4, y: 3 },
                { x: 5, y: 3 },
                { x: 6, y: 3 },
              ],
              entrance: { x: 5, y: 3 },
              searchTiles: [
                { x: 4, y: 3 },
                { x: 6, y: 3 },
              ],
              discoveries: [],
            },
            {
              id: 'north',
              name: 'Back room',
              tiles: [
                { x: 4, y: 5 },
                { x: 5, y: 5 },
                { x: 6, y: 5 },
              ],
              entrance: { x: 5, y: 5 },
              searchTiles: [
                { x: 4, y: 5 },
                { x: 6, y: 5 },
              ],
              discoveries: [{ id: 'dummy', name: 'Dummy', position: { x: 4, y: 5 } }],
            },
          ],
        },
      },
    ],
  });
}

describe('building interiors', () => {
  it('blocks walls and closed doors and refuses entry until the door is passable', () => {
    const sim = yard();
    expect(sim.getSnapshot().blocked).toContainEqual({ x: 4, y: 4 });
    expect(sim.getSnapshot().blocked).toContainEqual({ x: 5, y: 4 });
    expect(sim.apply({ type: 'move-responder', responderId: 'b', destination: { x: 4, y: 4 } })).toEqual({
      ok: false,
      reason: CommandRejection.Blocked,
    });
    expect(sim.apply({ type: 'enter-building', responderId: 'b', buildingId: 'house' })).toEqual({
      ok: false,
      reason: CommandRejection.DoorClosed,
    });
    expect(sim.apply({ type: 'open-door', responderId: 'b', doorId: 'door-out' })).toEqual({
      ok: false,
      reason: CommandRejection.DoorClosed,
    });
  });

  it('forces the entrance, opens the interior door, and walks between rooms', () => {
    const sim = yard();
    expect(sim.apply({ type: 'force-door', responderId: 'a', doorId: 'door-out' })).toEqual({ ok: true });
    expect(sim.apply({ type: 'force-door', responderId: 'b', doorId: 'door-out' })).toEqual({
      ok: false,
      reason: CommandRejection.Reserved,
    });
    until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-out')?.state === 'forced');
    expect(sim.getSnapshot().blocked.some((tile) => tile.x === 5 && tile.y === 2)).toBe(false);
    expect(sim.apply({ type: 'enter-building', responderId: 'a', buildingId: 'house' })).toEqual({ ok: true });
    until(sim, () => tileOf(entityAt(sim, 'a')) && at(entityAt(sim, 'a'), 5, 3));
    expect(sim.apply({ type: 'open-door', responderId: 'a', doorId: 'door-in' })).toEqual({ ok: true });
    until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-in')?.state === 'open');
    expect(sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 5, y: 5 } })).toEqual({
      ok: true,
    });
    until(sim, () => at(entityAt(sim, 'a'), 5, 5));
    expect(sim.getSnapshot().rooms.find((room) => room.id === 'north')?.discovered).toBe(true);
  });

  it('searches a room over time and reports the discovery', () => {
    const sim = opened();
    expect(sim.apply({ type: 'search-room', responderId: 'a', roomId: 'south' })).toEqual({ ok: true });
    const started = sim.getSnapshot().tasks.find((task) => task.kind === 'search-room');
    expect(started?.state).toBe('running');
    sim.tick();
    expect(sim.getSnapshot().rooms.find((room) => room.id === 'south')?.state).not.toBe('searched');
    until(sim, () => sim.getSnapshot().rooms.find((room) => room.id === 'south')?.state === 'searched');
    expect(sim.getSnapshot().notices.some((notice) => notice.message.includes('Entry'))).toBe(true);
  });

  it('splits a building search and keeps it running when one responder is overridden', () => {
    const sim = opened();
    expect(sim.apply({ type: 'open-door', responderId: 'a', doorId: 'door-in' })).toEqual({ ok: true });
    until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-in')?.state === 'open');
    expect(sim.apply({ type: 'search-building', teamId: 'engine-1', buildingId: 'house' })).toEqual({
      ok: true,
    });
    const assigned = sim
      .getSnapshot()
      .rooms.filter((room) => room.assigneeId)
      .map((room) => room.assigneeId);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.length).toBe(2);
    const overridden = assigned[0];
    expect(overridden).toBeTruthy();
    expect(
      sim.apply({ type: 'move-responder', responderId: overridden!, destination: { x: 0, y: 0 } }),
    ).toEqual({ ok: true });
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'search-building')?.state).toBe('running');
    until(sim, () => sim.getSnapshot().rooms.every((room) => room.state === 'searched'));
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'search-building')?.state).toBe('completed');
    expect(sim.getSnapshot().rooms.find((room) => room.id === 'north')?.discoveries[0]?.found).toBe(true);
    const restored = restoreSimulation(sim.exportSave());
    expect(restored.ok).toBe(true);
  });

  it('marks an unreachable room blocked and cancels a search without finishing it', () => {
    const sim = opened();
    expect(sim.apply({ type: 'search-room', responderId: 'b', roomId: 'north' })).toEqual({
      ok: false,
      reason: CommandRejection.NoPath,
    });
    expect(sim.apply({ type: 'search-building', teamId: 'engine-1', buildingId: 'house' })).toEqual({
      ok: true,
    });
    const search = sim.getSnapshot().tasks.find((task) => task.kind === 'search-room');
    expect(search).toBeTruthy();
    expect(sim.apply({ type: 'cancel-task', taskId: search!.id })).toEqual({ ok: true });
    expect(sim.getSnapshot().rooms.find((room) => room.id === 'south')?.state).toBe('unsearched');
    expect(sim.apply({ type: 'search-building', teamId: 'engine-1', buildingId: 'house' })).toEqual({
      ok: true,
    });
    until(sim, () => sim.getSnapshot().rooms.every((room) => room.state === 'searched'));
  });

  it('forces a locked entrance and opens the interior door during a building search', () => {
    const sim = yard();
    expect(sim.apply({ type: 'search-building', teamId: 'engine-1', buildingId: 'house' })).toEqual({
      ok: true,
    });
    until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-out')?.state === 'forced');
    until(sim, () => sim.getSnapshot().rooms.every((room) => room.state === 'searched'));
    expect(sim.getSnapshot().objects.find((object) => object.id === 'door-in')?.state).toBe('open');
    expect(sim.getSnapshot().notices.some((notice) => notice.message.includes('cannot be reached'))).toBe(
      false,
    );
  });

  it('marks every room blocked when a locked entrance cannot be forced', () => {
    const sim = yard(false);
    expect(sim.apply({ type: 'search-building', teamId: 'engine-1', buildingId: 'house' })).toEqual({
      ok: true,
    });
    expect(sim.getSnapshot().rooms.every((room) => room.state === 'blocked')).toBe(true);
    expect(sim.getSnapshot().notices.some((notice) => notice.message.includes('cannot be reached'))).toBe(
      true,
    );
  });

  it('continues a saved search from the same progress', () => {
    const sim = opened();
    sim.apply({ type: 'search-room', responderId: 'a', roomId: 'south' });
    until(sim, () => {
      const task = sim.getSnapshot().tasks.find((candidate) => candidate.kind === 'search-room');
      return task?.state === 'running' && 'searchIndex' in task && task.searchIndex >= 1;
    });
    const before = sim.getSnapshot().tasks.find((task) => task.kind === 'search-room');
    const restoredResult = restoreSimulation(sim.exportSave());
    expect(restoredResult.ok).toBe(true);
    if (!restoredResult.ok) return;
    const restored = restoredResult.simulation;
    const after = restored.getSnapshot().tasks.find((task) => task.kind === 'search-room');
    expect(after && 'searchIndex' in after ? after.searchIndex : -1).toBe(
      before && 'searchIndex' in before ? before.searchIndex : -2,
    );
    expect(restored.getSnapshot().rooms.find((room) => room.id === 'south')?.state).toBe('searching');
    until(restored, () => restored.getSnapshot().rooms.find((room) => room.id === 'south')?.state === 'searched');
    const againResult = restoreSimulation(restored.exportSave());
    expect(againResult.ok).toBe(true);
    if (!againResult.ok) return;
    expect(againResult.simulation.getSnapshot().rooms.find((room) => room.id === 'south')?.state).toBe(
      'searched',
    );
  });
});

function opened(): Simulation {
  const sim = yard();
  sim.apply({ type: 'force-door', responderId: 'a', doorId: 'door-out' });
  until(sim, () => sim.getSnapshot().objects.find((object) => object.id === 'door-out')?.state === 'forced');
  return sim;
}

function at(entity: { position: { x: number; y: number } }, x: number, y: number): boolean {
  return Math.abs(entity.position.x - (x + 0.5)) < 0.05 && Math.abs(entity.position.y - (y + 0.5)) < 0.05;
}

function tileOf(entity: { position: { x: number; y: number } }): boolean {
  return Number.isFinite(entity.position.x);
}
