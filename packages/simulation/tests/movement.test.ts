import { describe, expect, it } from 'vitest';

import { CommandRejection } from '../src/index.ts';
import { entityAt, simulation } from './helpers.ts';

describe('movement commands', () => {
  it('moves a responder toward the destination and completes on arrival', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });

    const result = sim.apply({
      type: 'move-responder',
      responderId: 'a',
      destination: { x: 3, y: 0 },
    });

    expect(result).toEqual({ ok: true });
    const start = entityAt(sim, 'a').position;
    const startDistance = Math.hypot(3.5 - start.x, 0.5 - start.y);

    for (let tick = 0; tick < 5; tick += 1) sim.tick();
    const midway = entityAt(sim, 'a');
    const midwayDistance = Math.hypot(3.5 - midway.position.x, 0.5 - midway.position.y);
    expect(midwayDistance).toBeLessThan(startDistance);

    for (let tick = 0; tick < 20; tick += 1) sim.tick();
    const arrived = entityAt(sim, 'a');
    expect(arrived.position).toEqual({ x: 3.5, y: 0.5 });
    expect(sim.getSnapshot().tasks.find((task) => task.assigneeId === 'a')?.state).toBe(
      'completed',
    );
  });

  it('rejects unknown responders, blocked tiles, unreachable tiles, and positions outside the map', () => {
    const sim = simulation({
      width: 5,
      height: 5,
      blocked: [
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 2, y: 1 },
        { x: 2, y: 3 },
      ],
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });

    const before = sim.getSnapshot();

    expect(
      sim.apply({ type: 'move-responder', responderId: 'missing', destination: { x: 1, y: 1 } }),
    ).toEqual({ ok: false, reason: CommandRejection.UnknownResponder });
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 1, y: 2 } }),
    ).toEqual({ ok: false, reason: CommandRejection.Blocked });
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 9, y: 1 } }),
    ).toEqual({ ok: false, reason: CommandRejection.OutOfBounds });
    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 2 } }),
    ).toEqual({ ok: false, reason: CommandRejection.NoPath });
    expect(
      sim.apply({ type: 'move-team', teamId: 'ladder-1', destination: { x: 1, y: 0 } }),
    ).toEqual({
      ok: false,
      reason: CommandRejection.UnknownTeam,
    });

    expect(sim.getSnapshot().tasks).toEqual(before.tasks);
    expect(sim.getSnapshot().tick).toBe(before.tick);
  });
});
