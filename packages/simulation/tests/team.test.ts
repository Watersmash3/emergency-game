import { describe, expect, it } from 'vitest';

import { CommandRejection } from '../src/index.ts';
import { entityAt, simulation } from './helpers.ts';

function seal(x: number, y: number) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

describe('team orders and individual overrides', () => {
  it('assigns a running move to every member on distinct tiles', () => {
    const sim = simulation();
    const result = sim.apply({
      type: 'move-team',
      teamId: 'engine-1',
      destination: { x: 6, y: 4 },
    });

    expect(result).toEqual({ ok: true });
    const running = sim.getSnapshot().tasks.filter((task) => task.state === 'running');
    expect(running).toHaveLength(2);
    expect(running.every((task) => task.source === 'team' && task.groupId)).toBe(true);
    const destinations = running.map((task) => {
      if (task.kind !== 'move') throw new Error('expected a move task');
      return `${task.destination.x},${task.destination.y}`;
    });
    expect(new Set(destinations).size).toBe(2);
    expect(destinations).toContain('6,4');
  });

  it('suspends only the overridden member and lets the others keep moving', () => {
    const sim = simulation({ speed: 4 });
    sim.apply({ type: 'move-team', teamId: 'engine-1', destination: { x: 8, y: 0 } });
    sim.tick();

    const teamTaskB = sim
      .getSnapshot()
      .tasks.find((task) => task.assigneeId === 'b' && task.source === 'team');
    const beforeB = entityAt(sim, 'b').position;

    const override = sim.apply({
      type: 'move-responder',
      responderId: 'a',
      destination: { x: 0, y: 5 },
    });

    expect(override).toEqual({ ok: true });
    const tasks = sim.getSnapshot().tasks;
    expect(tasks.find((task) => task.assigneeId === 'a' && task.source === 'team')?.state).toBe(
      'suspended',
    );
    expect(
      tasks.find((task) => task.assigneeId === 'a' && task.source === 'individual')?.state,
    ).toBe('running');
    expect(tasks.find((task) => task.id === teamTaskB?.id)?.state).toBe('running');

    sim.tick();
    expect(entityAt(sim, 'b').position.x).toBeGreaterThan(beforeB.x);
    for (let tick = 0; tick < 8; tick += 1) sim.tick();
    expect(entityAt(sim, 'a').position.y).toBeGreaterThan(0.5);
  });

  it('resumes the suspended team move after the override finishes', () => {
    const sim = simulation({
      speed: 4,
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 },
        { id: 'b', name: 'B', position: { x: 0, y: 1 }, speed: 4 },
      ],
    });

    sim.apply({ type: 'move-team', teamId: 'engine-1', destination: { x: 8, y: 0 } });
    const teamTaskA = sim
      .getSnapshot()
      .tasks.find((task) => task.assigneeId === 'a' && task.source === 'team');

    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 2 } });

    for (let tick = 0; tick < 40 && teamTaskA; tick += 1) {
      const task = sim.getSnapshot().tasks.find((candidate) => candidate.id === teamTaskA.id);
      if (task?.state === 'running' && tick > 0) break;
      sim.tick();
    }

    const resumed = sim.getSnapshot().tasks.find((task) => task.id === teamTaskA?.id);
    expect(resumed?.state).toBe('running');
    expect(
      sim
        .getSnapshot()
        .tasks.find((task) => task.assigneeId === 'a' && task.source === 'individual')?.state,
    ).toBe('completed');

    if (resumed?.kind !== 'move') throw new Error('expected a move task');
    const goal = resumed.destination;
    const before = entityAt(sim, 'a').position;
    const beforeDistance = Math.hypot(goal.x + 0.5 - before.x, goal.y + 0.5 - before.y);
    for (let tick = 0; tick < 8; tick += 1) sim.tick();
    const after = entityAt(sim, 'a').position;
    const afterDistance = Math.hypot(goal.x + 0.5 - after.x, goal.y + 0.5 - after.y);
    expect(afterDistance).toBeLessThan(beforeDistance);
  });

  it('replaces an override without cancelling the suspended team task', () => {
    const sim = simulation();
    sim.apply({ type: 'move-team', teamId: 'engine-1', destination: { x: 7, y: 7 } });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 0, y: 4 } });
    const firstOverride = sim
      .getSnapshot()
      .tasks.find((task) => task.assigneeId === 'a' && task.source === 'individual');

    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 4, y: 0 } });
    const tasks = sim.getSnapshot().tasks;
    expect(tasks.find((task) => task.id === firstOverride?.id)?.state).toBe('cancelled');
    const teamTask = tasks.find((task) => task.assigneeId === 'a' && task.source === 'team');
    const replacement = tasks.find(
      (task) => task.assigneeId === 'a' && task.source === 'individual' && task.state === 'running',
    );
    expect(teamTask?.state).toBe('suspended');
    expect(teamTask?.suspendedByTaskId).toBe(replacement?.id);
  });

  it('fails only the member who cannot reach the order', () => {
    const sim = simulation({
      width: 12,
      height: 12,
      blocked: seal(10, 10),
      responders: [
        { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 },
        { id: 'b', name: 'B', position: { x: 10, y: 10 }, speed: 4 },
      ],
    });

    const result = sim.apply({
      type: 'move-team',
      teamId: 'engine-1',
      destination: { x: 2, y: 2 },
    });
    expect(result).toEqual({ ok: true });

    const tasks = sim.getSnapshot().tasks;
    expect(tasks.find((task) => task.assigneeId === 'a')?.state).toBe('running');
    expect(tasks.find((task) => task.assigneeId === 'b')?.state).toBe('failed');
    expect(tasks.find((task) => task.assigneeId === 'b')?.failureReason).toBe(
      CommandRejection.NoPath,
    );
  });

  it('rejects a team order when nobody can reach it and leaves tasks unchanged', () => {
    const sim = simulation({
      width: 12,
      height: 12,
      blocked: [...seal(1, 1), ...seal(10, 10)],
      responders: [
        { id: 'a', name: 'A', position: { x: 1, y: 1 }, speed: 4 },
        { id: 'b', name: 'B', position: { x: 10, y: 10 }, speed: 4 },
      ],
    });

    const result = sim.apply({
      type: 'move-team',
      teamId: 'engine-1',
      destination: { x: 6, y: 6 },
    });
    expect(result).toEqual({ ok: false, reason: CommandRejection.NoPath });
    expect(sim.getSnapshot().tasks).toEqual([]);
  });
});
