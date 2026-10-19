import { describe, expect, it } from 'vitest';

import type { Simulation } from '../src/index.ts';
import { CommandRejection } from '../src/index.ts';
import { entityAt, simulation } from './helpers.ts';

const catalog = [
  { id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] },
  { id: 'medical-bag', name: 'Medical bag', capabilities: ['medical'] },
  { id: 'extinguisher', name: 'Fire extinguisher', capabilities: ['extinguish'] },
];

function yard(
  input: {
    capacity?: number;
    memberIds?: string[];
    responders?: { id: string; name: string; position: { x: number; y: number }; speed: number }[];
    equipment?: { id: string; definitionId: string; locationId?: string; ownerId?: string }[];
    blocked?: { x: number; y: number }[];
  } = {},
) {
  const responders = input.responders ?? [
    { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 },
    { id: 'b', name: 'B', position: { x: 0, y: 1 }, speed: 20 },
  ];
  return simulation({
    speed: 20,
    responders,
    memberIds: input.memberIds,
    inventoryCapacity: input.capacity ?? 2,
    blocked: input.blocked,
    objects: [
      {
        id: 'locker',
        name: 'Locker',
        objectType: 'locker',
        position: { x: 2, y: 0 },
        state: 'stocked',
      },
      {
        id: 'door',
        name: 'Door',
        objectType: 'door',
        position: { x: 6, y: 0 },
        state: 'locked',
        requiredCapability: 'force-entry',
      },
      { id: 'panel', name: 'Panel', objectType: 'panel', position: { x: 2, y: 3 }, state: 'idle' },
    ],
    equipmentCatalog: catalog,
    equipment: input.equipment ?? [
      { id: 'item-halligan', definitionId: 'halligan', locationId: 'locker' },
      { id: 'item-bag', definitionId: 'medical-bag', locationId: 'locker' },
      { id: 'item-extinguisher', definitionId: 'extinguisher', locationId: 'locker' },
    ],
  });
}

function until(sim: Simulation, predicate: () => boolean, max = 400): void {
  for (let tick = 0; tick < max && !predicate(); tick += 1) sim.tick();
  expect(predicate()).toBe(true);
}

describe('interactions and equipment', () => {
  it('retrieves equipment and records the new owner', () => {
    const sim = yard();
    const result = sim.apply({
      type: 'retrieve-equipment',
      responderId: 'a',
      lockerId: 'locker',
      definitionId: 'halligan',
    });

    expect(result).toEqual({ ok: true });
    until(sim, () => entityAt(sim, 'a').inventory.some((item) => item.definitionId === 'halligan'));

    const snapshot = sim.getSnapshot();
    expect(snapshot.entities.find((entity) => entity.id === 'b')?.inventory).toEqual([]);
    expect(snapshot.objects.find((object) => object.id === 'locker')?.contents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'item-halligan' })]),
    );
    expect(
      snapshot.tasks.find((task) => task.kind === 'retrieve-equipment' && !task.parentId)?.state,
    ).toBe('completed');
  });

  it('rejects a second claim on an exclusive item', () => {
    const sim = yard({
      equipment: [{ id: 'item-halligan', definitionId: 'halligan', locationId: 'locker' }],
    });
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'a',
        lockerId: 'locker',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: true });

    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'b',
        lockerId: 'locker',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: false, reason: CommandRejection.Reserved });
    expect(entityAt(sim, 'b').inventory).toEqual([]);
    expect(
      sim
        .getSnapshot()
        .objects.find((object) => object.id === 'locker')
        ?.contents.find((item) => item.id === 'item-halligan')?.reserved,
    ).toBe(true);
  });

  it('operates a reachable panel and rejects an unreachable locker', () => {
    const sim = yard();
    expect(sim.apply({ type: 'operate-panel', responderId: 'a', panelId: 'panel' })).toEqual({
      ok: true,
    });
    until(
      sim,
      () => sim.getSnapshot().objects.find((object) => object.id === 'panel')?.state === 'operated',
    );

    const sealed = yard({
      blocked: [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 0, y: 2 }, speed: 20 },
      ],
    });
    expect(sealed.getSnapshot().tasks).toEqual([]);
    expect(
      sealed.apply({
        type: 'retrieve-equipment',
        responderId: 'a',
        lockerId: 'locker',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: false, reason: CommandRejection.NoPath });
    expect(sealed.getSnapshot().tasks).toEqual([]);
  });

  it('forces a door when the responder already has a halligan', () => {
    const sim = yard({
      equipment: [{ id: 'item-halligan', definitionId: 'halligan', ownerId: 'a' }],
    });
    expect(sim.apply({ type: 'force-door', responderId: 'a', doorId: 'door' })).toEqual({
      ok: true,
    });
    until(
      sim,
      () => sim.getSnapshot().objects.find((object) => object.id === 'door')?.state === 'open',
    );
    expect(sim.getSnapshot().blocked.some((tile) => tile.x === 6 && tile.y === 0)).toBe(false);
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'force-door')?.state).toBe(
      'completed',
    );
  });

  it('retrieves a halligan and then forces the door', () => {
    const sim = yard();
    expect(sim.apply({ type: 'force-door', responderId: 'a', doorId: 'door' })).toEqual({
      ok: true,
    });
    until(
      sim,
      () => sim.getSnapshot().objects.find((object) => object.id === 'door')?.state === 'open',
    );
    expect(entityAt(sim, 'a').inventory.some((item) => item.definitionId === 'halligan')).toBe(
      true,
    );
  });

  it('assigns team retrieval without giving one item to two members', () => {
    const sim = yard({
      equipment: [{ id: 'item-halligan', definitionId: 'halligan', locationId: 'locker' }],
    });
    const result = sim.apply({ type: 'retrieve-team', teamId: 'engine-1', lockerId: 'locker' });

    expect(result).toEqual({ ok: true });
    const tasks = sim
      .getSnapshot()
      .tasks.filter((task) => task.kind === 'retrieve-equipment' && !task.parentId);
    expect(tasks.find((task) => task.assigneeId === 'a')?.state).toBe('running');
    expect(tasks.find((task) => task.assigneeId === 'b')?.state).toBe('failed');
    expect(tasks.find((task) => task.assigneeId === 'b')?.failureReason).toBe(
      CommandRejection.NoEquipment,
    );
    expect(new Set(tasks.map((task) => task.groupId)).size).toBe(1);

    until(sim, () => entityAt(sim, 'a').inventory.length === 1);
    expect(entityAt(sim, 'b').inventory).toEqual([]);
  });

  it('suspends one team retrieval and lets the other member continue', () => {
    const sim = yard();
    sim.apply({ type: 'retrieve-team', teamId: 'engine-1', lockerId: 'locker' });
    const beforeB = entityAt(sim, 'b').position;
    const override = sim.apply({
      type: 'move-responder',
      responderId: 'a',
      destination: { x: 0, y: 4 },
    });

    expect(override).toEqual({ ok: true });
    const tasks = sim.getSnapshot().tasks;
    expect(
      tasks.find(
        (task) => task.assigneeId === 'a' && task.kind === 'retrieve-equipment' && !task.parentId,
      )?.state,
    ).toBe('suspended');
    expect(
      tasks.find(
        (task) => task.assigneeId === 'b' && task.kind === 'retrieve-equipment' && !task.parentId,
      )?.state,
    ).toBe('running');

    sim.tick();
    expect(entityAt(sim, 'b').position).not.toEqual(beforeB);
    expect(
      sim
        .getSnapshot()
        .tasks.find(
          (task) => task.assigneeId === 'a' && task.kind === 'retrieve-equipment' && !task.parentId,
        )?.state,
    ).toBe('suspended');
  });

  it('fails a suspended retrieval on resume when the inventory can no longer hold it', () => {
    const sim = yard({
      capacity: 1,
      memberIds: ['a'],
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 0, y: 1 }, speed: 20 },
      ],
    });
    sim.apply({ type: 'retrieve-team', teamId: 'engine-1', lockerId: 'locker' });
    const teamTask = sim
      .getSnapshot()
      .tasks.find((task) => task.assigneeId === 'a' && task.source === 'team' && !task.parentId);
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'a',
        lockerId: 'locker',
        definitionId: 'medical-bag',
      }),
    ).toEqual({ ok: true });

    until(
      sim,
      () => sim.getSnapshot().tasks.find((task) => task.id === teamTask?.id)?.state === 'failed',
    );
    const failed = sim.getSnapshot().tasks.find((task) => task.id === teamTask?.id);
    expect(failed?.failureReason).toBe(CommandRejection.InventoryFull);
    expect(
      sim
        .getSnapshot()
        .tasks.filter(
          (task) => task.assigneeId === 'a' && task.source === 'team' && !task.parentId,
        ),
    ).toHaveLength(1);
    expect(
      sim
        .getSnapshot()
        .objects.find((object) => object.id === 'locker')
        ?.contents.find((item) => item.definitionId === 'halligan')?.reserved,
    ).toBe(false);

    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'b',
        lockerId: 'locker',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: true });
  });

  it('releases a reservation when the task is cancelled', () => {
    const sim = yard({
      equipment: [{ id: 'item-halligan', definitionId: 'halligan', locationId: 'locker' }],
    });
    sim.apply({
      type: 'retrieve-equipment',
      responderId: 'a',
      lockerId: 'locker',
      definitionId: 'halligan',
    });
    const taskId = sim
      .getSnapshot()
      .tasks.find((task) => task.kind === 'retrieve-equipment' && !task.parentId)?.id;
    expect(taskId).toBeTruthy();
    expect(sim.apply({ type: 'cancel-task', taskId: taskId ?? '' })).toEqual({ ok: true });
    expect(
      sim
        .getSnapshot()
        .objects.find((object) => object.id === 'locker')
        ?.contents.find((item) => item.id === 'item-halligan')?.reserved,
    ).toBe(false);
    expect(
      sim.apply({
        type: 'retrieve-equipment',
        responderId: 'b',
        lockerId: 'locker',
        definitionId: 'halligan',
      }),
    ).toEqual({ ok: true });
  });

  it('does not advance interaction progress while paused', () => {
    const sim = yard({
      responders: [
        { id: 'a', name: 'A', position: { x: 2, y: 3 }, speed: 20 },
        { id: 'b', name: 'B', position: { x: 0, y: 1 }, speed: 20 },
      ],
    });
    sim.apply({ type: 'operate-panel', responderId: 'a', panelId: 'panel' });
    until(sim, () =>
      sim.getSnapshot().tasks.some((task) => task.kind === 'interact' && task.progressTicks > 0),
    );

    const before = sim.getSnapshot();
    const progress = before.tasks.find((task) => task.kind === 'interact')?.progressTicks;
    sim.apply({ type: 'pause' });
    sim.step(1000);
    sim.tick();
    const paused = sim.getSnapshot();
    expect(paused.tick).toBe(before.tick);
    expect(paused.tasks.find((task) => task.kind === 'interact')?.progressTicks).toBe(progress);
    expect(entityAt(sim, 'a').position).toEqual(entityAtFrom(before, 'a'));

    sim.apply({ type: 'resume' });
    sim.tick();
    expect(sim.getSnapshot().tasks.find((task) => task.kind === 'interact')?.progressTicks).toBe(
      (progress ?? 0) + 1,
    );
  });
});

function entityAtFrom(
  snapshot: ReturnType<Simulation['getSnapshot']>,
  id: string,
): { x: number; y: number } {
  const entity = snapshot.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`Missing entity ${id}`);
  return entity.position;
}
