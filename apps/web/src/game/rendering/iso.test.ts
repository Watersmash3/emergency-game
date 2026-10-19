import { describe, expect, it } from 'vitest';

import { screenToTile, worldToScreen } from './iso.ts';

describe('isometric projection', () => {
  it('maps a tile center back to that tile', () => {
    const screen = worldToScreen(2.5, 3.5);
    expect(screenToTile(screen.x, screen.y)).toEqual({ x: 2, y: 3 });
  });

  it('keeps neighboring tiles on different screen points', () => {
    const origin = worldToScreen(1.5, 1.5);
    const east = worldToScreen(2.5, 1.5);
    expect(east.x).not.toBe(origin.x);
    expect(screenToTile(east.x, east.y)).toEqual({ x: 2, y: 1 });
  });
});
