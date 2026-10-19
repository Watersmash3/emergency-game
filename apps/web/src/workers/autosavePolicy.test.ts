import { describe, expect, it } from 'vitest';

import { shouldAutosave } from './autosavePolicy.ts';

describe('autosave policy', () => {
  it('waits for the player before writing over recovery slots', () => {
    expect(shouldAutosave(false, 0, 100)).toBe(false);
    expect(shouldAutosave(false, 90, 108)).toBe(false);
    expect(shouldAutosave(true, 0, 50)).toBe(false);
    expect(shouldAutosave(true, 90, 100)).toBe(true);
    expect(shouldAutosave(true, 12921, 12922)).toBe(false);
    expect(shouldAutosave(true, 12990, 13002)).toBe(true);
  });
});
