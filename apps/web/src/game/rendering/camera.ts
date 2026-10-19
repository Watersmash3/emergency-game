import { TILE_HEIGHT, TILE_WIDTH, worldToScreen } from './iso.ts';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.4;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Screen bounds of a map, including the outer tile diamonds. */
export function mapScreenBounds(width: number, height: number): Bounds {
  const samples = [
    worldToScreen(0.5, 0.5),
    worldToScreen(width - 0.5, 0.5),
    worldToScreen(0.5, height - 0.5),
    worldToScreen(width - 0.5, height - 0.5),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of samples) {
    minX = Math.min(minX, point.x - TILE_WIDTH / 2);
    maxX = Math.max(maxX, point.x + TILE_WIDTH / 2);
    minY = Math.min(minY, point.y - TILE_HEIGHT / 2);
    maxY = Math.max(maxY, point.y + TILE_HEIGHT / 2);
  }
  return { minX, minY, maxX, maxY };
}

export function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Zoom that frames the training yard inside the viewport, leaving room for the HUD. */
export function fitZoom(
  viewWidth: number,
  viewHeight: number,
  bounds: Bounds,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): number {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const marginX = viewWidth >= 1280 ? 0.7 : 0.92;
  const marginY = viewHeight >= 720 ? 0.76 : 0.9;
  const zoom = Math.min((viewWidth * marginX) / spanX, (viewHeight * marginY) / spanY);
  return Math.min(max, Math.max(min, zoom));
}

export function canvasSize(width: number, height: number): { width: number; height: number } {
  return {
    width: width > 0 ? Math.floor(width) : 960,
    height: height > 0 ? Math.floor(height) : 540,
  };
}

/** Inverse of a top-left Phaser camera. Zoom scales around the scroll origin. */
export function viewToWorld(
  pointerX: number,
  pointerY: number,
  scrollX: number,
  scrollY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: scrollX + pointerX / zoom, y: scrollY + pointerY / zoom };
}

export function focusCenter(points: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  const first = points[0];
  if (!first) return null;
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}
