import type { Tile, Vec2 } from '@emergency/protocol';

export function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(width: number, height: number, tile: Tile): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height;
}

export function isBlocked(blocked: Set<string>, tile: Tile): boolean {
  return blocked.has(tileKey(tile));
}

export function isWalkable(
  width: number,
  height: number,
  blocked: Set<string>,
  tile: Tile,
): boolean {
  return inBounds(width, height, tile) && !isBlocked(blocked, tile);
}

/** Tile index containing a continuous world position. Tile centers are at n + 0.5. */
export function tileOf(position: Vec2): Tile {
  return { x: Math.floor(position.x), y: Math.floor(position.y) };
}

export function tileCenter(tile: Tile): Vec2 {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

export function manhattan(a: Tile, b: Tile): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
