import { describe, expect, it } from 'vitest';

import {
  boundsCenter,
  canvasSize,
  fitZoom,
  focusCenter,
  mapScreenBounds,
  viewToWorld,
} from './camera.ts';
import { screenToTile, worldToScreen } from './iso.ts';

describe('viewport camera', () => {
  it('uses the available canvas size at desktop resolutions', () => {
    expect(canvasSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(canvasSize(2560, 1440)).toEqual({ width: 2560, height: 1440 });
    expect(canvasSize(0, 0)).toEqual({ width: 960, height: 540 });
  });

  it('frames the training yard across the viewport', () => {
    const bounds = mapScreenBounds(20, 20);
    const laptop = fitZoom(1366, 768, bounds);
    const desktop = fitZoom(1920, 1080, bounds);
    const wide = fitZoom(2560, 1440, bounds);
    expect(desktop).toBeGreaterThan(laptop);
    expect(wide).toBeGreaterThan(desktop);
    expect(((bounds.maxX - bounds.minX) * desktop) / 1920).toBeGreaterThan(0.55);
    expect(boundsCenter(bounds).x).toBeCloseTo((bounds.minX + bounds.maxX) / 2);
  });

  it('keeps a screen point on the same tile after zoom', () => {
    const world = worldToScreen(10.5, 10.5);
    for (const zoom of [0.7, 1, 1.6]) {
      const scrollX = world.x - 480 / zoom;
      const scrollY = world.y - 270 / zoom;
      const back = viewToWorld(480, 270, scrollX, scrollY, zoom);
      expect(back.x).toBeCloseTo(world.x);
      expect(back.y).toBeCloseTo(world.y);
      expect(screenToTile(back.x, back.y)).toEqual({ x: 10, y: 10 });
    }
  });

  it('centers a selection on the average of its points', () => {
    expect(focusCenter([])).toBeNull();
    expect(focusCenter([{ x: 0, y: 0 }, { x: 10, y: 4 }])).toEqual({ x: 5, y: 2 });
  });
});
