import { describe, expect, it } from 'vitest';

import { findPath } from '../src/index.ts';

describe('pedestrian A*', () => {
  const grid = { width: 6, height: 4, blocked: new Set(['1,0']) };

  it('walks a clear row from start to goal', () => {
    expect(
      findPath({ width: 6, height: 1, blocked: new Set() }, { x: 0, y: 0 }, { x: 3, y: 0 }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('routes around a blocked tile', () => {
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });

    expect(path).not.toBeNull();
    expect(path).not.toContainEqual({ x: 1, y: 0 });
    expect(path?.[0]).toEqual({ x: 0, y: 0 });
    expect(path?.at(-1)).toEqual({ x: 2, y: 0 });
  });

  it('returns null when the goal is sealed off', () => {
    const sealed = {
      width: 5,
      height: 5,
      blocked: new Set(['1,2', '3,2', '2,1', '2,3']),
    };

    expect(findPath(sealed, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('stays on the current tile when the goal is the start', () => {
    expect(findPath(grid, { x: 4, y: 1 }, { x: 4, y: 1 })).toEqual([{ x: 4, y: 1 }]);
  });
});
