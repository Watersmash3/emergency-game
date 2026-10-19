import { describe, expect, it } from 'vitest';

import { idsInside, mergeIds, soleResponder } from './selection.ts';

describe('selection', () => {
  it('replaces, adds, and toggles responders', () => {
    expect(mergeIds(['a'], ['b'], false, false)).toEqual(['b']);
    expect(mergeIds(['a'], ['b'], true, false)).toEqual(['a', 'b']);
    expect(mergeIds(['a', 'b'], ['b'], true, true)).toEqual(['a']);
    expect(soleResponder({ kind: 'responders', ids: ['a'] })).toBe('a');
    expect(soleResponder({ kind: 'responders', ids: ['a', 'b'] })).toBeNull();
  });

  it('collects responders inside a drag rectangle', () => {
    const points = [
      { id: 'hayes', x: 20, y: 20 },
      { id: 'brooks', x: 80, y: 40 },
      { id: 'diaz', x: 200, y: 200 },
    ];
    expect(idsInside(points, { left: 100, top: 80, right: 10, bottom: 10 })).toEqual([
      'hayes',
      'brooks',
    ]);
  });
});
