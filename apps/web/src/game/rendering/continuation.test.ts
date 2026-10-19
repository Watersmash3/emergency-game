import { describe, expect, it } from 'vitest';

import { isTickContinuation, type ContinuitySnapshot } from './continuation.ts';

function snapshot(tick: number, x = 2.5, vehicleX = 1.5): ContinuitySnapshot {
  return {
    scenarioId: 'training-yard',
    tick,
    entities: [{ id: 'ff-hayes', position: { x, y: 2.5 } }],
    vehicles: [{ id: 'apparatus-engine-1', position: { x: vehicleX, y: 4.5 } }],
  };
}

describe('snapshot continuation', () => {
  it('treats the first snapshot and a normal step as the same view', () => {
    expect(isTickContinuation(null, snapshot(1))).toBe(true);
    expect(isTickContinuation(snapshot(10), snapshot(11))).toBe(true);
    expect(isTickContinuation(snapshot(10, 2.5), snapshot(18, 3.9))).toBe(true);
  });

  it('treats a load, a tick rewind, and a large move as a new view', () => {
    expect(isTickContinuation(snapshot(200), snapshot(40, 18.5))).toBe(false);
    expect(isTickContinuation(snapshot(50), snapshot(40))).toBe(false);
    expect(isTickContinuation(snapshot(10), snapshot(12, 8.5))).toBe(false);
    expect(isTickContinuation(snapshot(10, 2.5, 1.5), snapshot(12, 2.5, 9))).toBe(false);
    expect(isTickContinuation(snapshot(10), { ...snapshot(11), scenarioId: 'other-yard' })).toBe(
      false,
    );
  });
});
