import { describe, expect, it } from 'vitest';

import { entityAt, simulation } from './helpers.ts';

describe('tactical pause', () => {
  it('stops time and movement until resume', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });

    expect(
      sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 4, y: 0 } }),
    ).toEqual({
      ok: true,
    });
    sim.tick();
    expect(sim.apply({ type: 'pause' })).toEqual({ ok: true });

    const paused = sim.getSnapshot();
    expect(paused.paused).toBe(true);
    expect(sim.step(1000)).toBe(0);
    sim.tick();
    expect(sim.getSnapshot().tick).toBe(paused.tick);
    expect(entityAt(sim, 'a').position).toEqual(entityAtFrom(paused, 'a'));

    expect(sim.apply({ type: 'resume' })).toEqual({ ok: true });
    sim.tick();
    expect(sim.getSnapshot().tick).toBe(paused.tick + 1);
    expect(entityAt(sim, 'a').position.x).toBeGreaterThan(entityAtFrom(paused, 'a').x);
  });

  it('accepts a move during pause and starts it only after resume', () => {
    const sim = simulation({
      responders: [{ id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: 4 }],
      memberIds: ['a'],
    });

    sim.apply({ type: 'pause' });
    sim.apply({ type: 'move-responder', responderId: 'a', destination: { x: 2, y: 0 } });

    const paused = sim.getSnapshot();
    expect(paused.tasks[0]?.state).toBe('running');
    expect(sim.step(500)).toBe(0);
    expect(entityAt(sim, 'a').position).toEqual({ x: 0.5, y: 0.5 });

    sim.apply({ type: 'resume' });
    sim.tick();
    expect(entityAt(sim, 'a').position.x).toBeGreaterThan(0.5);
  });
});

function entityAtFrom(
  snapshot: ReturnType<ReturnType<typeof simulation>['getSnapshot']>,
  id: string,
) {
  const entity = snapshot.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(id);
  return entity.position;
}
