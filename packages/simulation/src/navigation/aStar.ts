import type { Tile } from '@emergency/protocol';

import { isWalkable, manhattan, sameTile, tileKey } from './grid.ts';

const NEIGHBORS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export interface PathGrid {
  width: number;
  height: number;
  blocked: Set<string>;
}

/**
 * 4-connected A*. Returns the tile path from start through goal, or null when
 * no walkable route exists. Units do not block each other.
 */
export function findPath(grid: PathGrid, start: Tile, goal: Tile): Tile[] | null {
  if (!isWalkable(grid.width, grid.height, grid.blocked, start)) return null;
  if (!isWalkable(grid.width, grid.height, grid.blocked, goal)) return null;
  if (sameTile(start, goal)) return [{ ...start }];

  const open: Tile[] = [{ ...start }];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[tileKey(start), 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    let bestIndex = 0;
    let bestF = Number.POSITIVE_INFINITY;
    for (let index = 0; index < open.length; index += 1) {
      const candidate = open[index];
      if (!candidate) continue;
      const g = gScore.get(tileKey(candidate)) ?? Number.POSITIVE_INFINITY;
      const f = g + manhattan(candidate, goal);
      if (f < bestF) {
        bestF = f;
        bestIndex = index;
      }
    }

    const current = open.splice(bestIndex, 1)[0];
    if (!current) break;
    const currentKey = tileKey(current);
    if (closed.has(currentKey)) continue;
    if (sameTile(current, goal)) return reconstruct(cameFrom, current);

    closed.add(currentKey);
    for (const step of NEIGHBORS) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      if (!isWalkable(grid.width, grid.height, grid.blocked, next)) continue;
      const nextKey = tileKey(next);
      if (closed.has(nextKey)) continue;
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative < (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        open.push(next);
      }
    }
  }

  return null;
}

function reconstruct(cameFrom: Map<string, string>, goal: Tile): Tile[] {
  const path: Tile[] = [{ ...goal }];
  let key = tileKey(goal);
  while (cameFrom.has(key)) {
    const previous = cameFrom.get(key);
    if (!previous) break;
    key = previous;
    const [xText, yText] = key.split(',');
    path.push({ x: Number(xText), y: Number(yText) });
  }
  path.reverse();
  return path;
}
