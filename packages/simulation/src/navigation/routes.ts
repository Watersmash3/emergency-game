import type { Tile } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { inBounds, isWalkable, manhattan, sameTile, tileKey, tileOf } from './grid.ts';

const NEIGHBORS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** How a route trades distance against hazards and doors. */
export type RoutePolicy = 'direct' | 'avoid-hazard' | 'tactical-entry' | 'withdrawal';

export interface PlannedDoor {
  id: string;
  force: boolean;
}

export interface PlannedRoute {
  tiles: Tile[];
  doors: PlannedDoor[];
  cost: number;
}

/**
 * Pedestrian route on the walkable grid. Preferred pathways cost less than open ground.
 * A tactical entry may cross a closed door and records the interaction. A locked door is
 * included only when forced entry is authorized. Hazard tiles are soft costs, and
 * avoid-hazard treats a severe cell as blocked when another route exists.
 */
export function planRoute(
  world: World,
  start: Tile,
  goal: Tile,
  policy: RoutePolicy = 'direct',
  forceEntry = false,
): PlannedRoute | null {
  if (!inBounds(world.width, world.height, start) || !inBounds(world.width, world.height, goal)) {
    return null;
  }
  const doors = doorCrossings(world, policy, forceEntry);
  if (!walkable(world, start, doors) || !walkable(world, goal, doors)) return null;
  if (sameTile(start, goal)) return { tiles: [{ ...start }], doors: [], cost: 0 };

  const open: Tile[] = [{ ...start }];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[tileKey(start), 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    let bestIndex = 0;
    let bestF = Number.POSITIVE_INFINITY;
    let bestY = Number.POSITIVE_INFINITY;
    let bestX = Number.POSITIVE_INFINITY;
    for (let index = 0; index < open.length; index += 1) {
      const candidate = open[index];
      if (!candidate) continue;
      const g = gScore.get(tileKey(candidate)) ?? Number.POSITIVE_INFINITY;
      const f = g + manhattan(candidate, goal);
      if (
        f < bestF - 1e-9 ||
        (Math.abs(f - bestF) <= 1e-9 && (candidate.y < bestY || (candidate.y === bestY && candidate.x < bestX)))
      ) {
        bestF = f;
        bestIndex = index;
        bestY = candidate.y;
        bestX = candidate.x;
      }
    }

    const current = open.splice(bestIndex, 1)[0];
    if (!current) break;
    const currentKey = tileKey(current);
    if (closed.has(currentKey)) continue;
    if (sameTile(current, goal)) {
      const tiles = reconstruct(cameFrom, current);
      return { tiles, doors: doorsOn(tiles, doors), cost: gScore.get(currentKey) ?? tiles.length };
    }

    closed.add(currentKey);
    for (const step of NEIGHBORS) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      if (!walkable(world, next, doors)) continue;
      if (blockedHazard(world, next, goal, policy)) continue;
      const nextKey = tileKey(next);
      if (closed.has(nextKey)) continue;
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + stepCost(world, next, policy);
      if (tentative < (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY) - 1e-9) {
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        open.push(next);
      }
    }
  }

  return null;
}

/** Distinct walkable tiles around a goal, nearest first, skipping tiles already reserved by a move. */
export function spacedTiles(world: World, goal: Tile, limit = 16): Tile[] {
  const reserved = reservedTiles(world);
  const tiles: Tile[] = [];
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const tile = { x, y };
      if (!isWalkable(world.width, world.height, world.blocked, tile)) continue;
      if (reserved.has(tileKey(tile))) continue;
      tiles.push(tile);
    }
  }
  tiles.sort((left, right) => {
    const goalBias = Number(left.x !== goal.x || left.y !== goal.y) - Number(right.x !== goal.x || right.y !== goal.y);
    if (goalBias !== 0) return goalBias;
    const distance = manhattan(left, goal) - manhattan(right, goal);
    if (distance !== 0) return distance;
    return left.y - right.y || left.x - right.x;
  });
  return tiles.slice(0, limit);
}

export interface WorkPosition {
  tile: Tile;
  reason?: string;
}

/** A reachable tile for a job, or a failure when every candidate is blocked. */
export function workPosition(
  world: World,
  from: Tile,
  kind: 'staging' | 'nozzle' | 'withdrawal' | 'assembly' | 'door',
  target?: { x: number; y: number; range?: number; maxLength?: number; anchor?: Tile },
): WorkPosition | { tile: null; reason: string } {
  const goal = target ?? from;
  let candidates = spacedTiles(world, { x: goal.x, y: goal.y }, 24);
  if (kind === 'nozzle' && target?.range !== undefined) {
    candidates = candidates.filter((tile) => manhattan(tile, goal) <= (target.range ?? 0));
    if (target.anchor && target.maxLength !== undefined) {
      candidates = candidates.filter((tile) => manhattan(tile, target.anchor as Tile) <= (target.maxLength ?? 0));
    }
  }
  if (kind === 'withdrawal' || kind === 'assembly') {
    candidates = candidates.filter((tile) => !insideRoom(world, tile));
    candidates.sort((left, right) => hazardScore(world, left) - hazardScore(world, right) || left.y - right.y || left.x - right.x);
  }
  for (const tile of candidates) {
    const policy = kind === 'withdrawal' ? 'avoid-hazard' : 'direct';
    if (planRoute(world, from, tile, policy) || (policy !== 'direct' && planRoute(world, from, tile, 'direct'))) {
      return { tile };
    }
  }
  return { tile: null, reason: 'No path to destination' };
}

function reservedTiles(world: World): Set<string> {
  const reserved = new Set<string>();
  for (const task of world.tasks.values()) {
    if (task.kind !== 'move') continue;
    if (task.state !== 'running' && task.state !== 'pending' && task.state !== 'ready') continue;
    reserved.add(tileKey(task.destination));
  }
  return reserved;
}

function doorCrossings(
  world: World,
  policy: RoutePolicy,
  forceEntry: boolean,
): Map<string, PlannedDoor> {
  const doors = new Map<string, PlannedDoor>();
  if (policy !== 'tactical-entry') return doors;
  for (const entity of world.entities.values()) {
    if (entity.interactable?.objectType !== 'door' || !entity.position) continue;
    const state = entity.interactable.state;
    if (state === 'open' || state === 'forced') continue;
    if (state === 'locked' && !forceEntry) continue;
    doors.set(tileKey(tileOf(entity.position)), { id: entity.id, force: state === 'locked' });
  }
  return doors;
}

function walkable(world: World, tile: Tile, doors: Map<string, PlannedDoor>): boolean {
  if (!inBounds(world.width, world.height, tile)) return false;
  if (doors.has(tileKey(tile))) return true;
  return isWalkable(world.width, world.height, world.blocked, tile);
}

function blockedHazard(world: World, tile: Tile, goal: Tile, policy: RoutePolicy): boolean {
  if (policy !== 'avoid-hazard' || sameTile(tile, goal)) return false;
  const cell = world.hazards.get(tileKey(tile));
  if (!cell) return false;
  return cell.smoke > 0.45 || cell.temperature > 120 || cell.combustion > 0.35;
}

function stepCost(world: World, tile: Tile, policy: RoutePolicy): number {
  const key = tileKey(tile);
  let cost = world.pathways.has(key) ? 0.85 : 1;
  if (policy === 'direct') return cost;
  const cell = world.hazards.get(key);
  if (cell && policy !== 'tactical-entry') {
    cost += cell.smoke * 4 + Math.max(0, cell.temperature - 60) / 50;
  }
  const damage = world.damage.get(key);
  if (damage && damage.integrity < 0.5) cost += 2;
  if (policy === 'avoid-hazard' || policy === 'withdrawal') {
    for (const entity of world.entities.values()) {
      if (!entity.responder || !entity.position) continue;
      const at = tileOf(entity.position);
      if (at.x === tile.x && at.y === tile.y) cost += 1.5;
    }
  }
  return cost;
}

function doorsOn(tiles: Tile[], doors: Map<string, PlannedDoor>): PlannedDoor[] {
  const found: PlannedDoor[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    const door = doors.get(tileKey(tile));
    if (!door || seen.has(door.id)) continue;
    seen.add(door.id);
    found.push(door);
  }
  return found;
}

function hazardScore(world: World, tile: Tile): number {
  const cell = world.hazards.get(tileKey(tile));
  if (!cell) return 0;
  return cell.smoke * 4 + Math.max(0, cell.temperature - 20) / 40 + cell.combustion;
}

function insideRoom(world: World, tile: Tile): boolean {
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) return true;
  }
  return false;
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
