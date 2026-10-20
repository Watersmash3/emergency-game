import { describe, expect, it } from 'vitest';

import { interiorRevealed } from './interior.ts';

describe('roof visibility', () => {
  it('reveals the interior from the roof mode and the selection', () => {
    expect(interiorRevealed('open', false)).toBe(true);
    expect(interiorRevealed('closed', true)).toBe(false);
    expect(interiorRevealed('auto', false)).toBe(false);
    expect(interiorRevealed('auto', true)).toBe(true);
    expect(interiorRevealed('auto', false, true)).toBe(true);
    expect(interiorRevealed('auto', false, false, true)).toBe(true);
    expect(interiorRevealed('closed', false, false, true)).toBe(false);
  });
});
