import { describe, expect, it } from 'vitest';

import { createRng } from '../src/index.ts';

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed', () => {
    const left = createRng(1104);
    const right = createRng(1104);
    const values = [left.next(), left.next(), left.next()];

    expect(values).toEqual([right.next(), right.next(), right.next()]);
    expect(left.getState()).toBe(right.getState());
  });
});
