export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

/** Project a simulation position (tile centers are at n + 0.5) into isometric screen space. */
export function worldToScreen(x: number, y: number): { x: number; y: number } {
  const column = x - 0.5;
  const row = y - 0.5;
  return {
    x: (column - row) * (TILE_WIDTH / 2),
    y: (column + row) * (TILE_HEIGHT / 2) + TILE_HEIGHT / 2,
  };
}

/** Inverse of worldToScreen. The result is the tile index under a screen point. */
export function screenToTile(screenX: number, screenY: number): { x: number; y: number } {
  const halfWidth = TILE_WIDTH / 2;
  const halfHeight = TILE_HEIGHT / 2;
  const column = (screenX / halfWidth + (screenY - halfHeight) / halfHeight) / 2;
  const row = ((screenY - halfHeight) / halfHeight - screenX / halfWidth) / 2;
  return { x: Math.floor(column), y: Math.floor(row) };
}
