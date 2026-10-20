import type { Tile, Vec2 } from '@emergency/protocol';

import type { EquipmentInstance } from '../components/equipment.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { isWalkable, tileOf } from '../navigation/grid.ts';
import { fireControlled, roomOverhauled } from '../systems/hazardQuery.ts';
import { CommandRejection } from './results.ts';
import type { SuppressFireTask, Task } from './types.ts';
import { approachTiles, blocksPedestrian, canTakeFrom } from './vehicleRules.ts';

export const SUPPRESS_CAPABILITY = 'suppress';

export function evaluateIncidents(world: World): void {
  for (const objective of world.objectives.values()) {
    if (objective.state === 'satisfied') continue;
    if (objective.kind === 'overhaul-room') {
      if (roomOverhauled(world, objective.targetId)) objective.state = 'satisfied';
      continue;
    }
    const fire = world.entities.get(objective.targetId)?.fire;
    if (fire && fireControlled(world, objective.targetId)) objective.state = 'satisfied';
  }
  for (const incident of world.incidents.values()) {
    const objectives = [...world.objectives.values()].filter(
      (objective) => objective.incidentId === incident.id,
    );
    if (objectives.length > 0 && objectives.every((objective) => objective.state === 'satisfied')) {
      incident.state = 'resolved';
    }
  }
}

export function canSuppress(world: World, item: EquipmentInstance): boolean {
  const definition = world.catalog.get(item.definitionId);
  return Boolean(
    definition &&
    definition.capabilities.includes(SUPPRESS_CAPABILITY) &&
    definition.suppression > 0 &&
    (item.agent ?? 0) > 0,
  );
}

export function carriedSuppress(world: World, responderId: string): EquipmentInstance | undefined {
  return [...world.equipment.values()]
    .filter((item) => item.ownerId === responderId && canSuppress(world, item))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
}

export function rangeTiles(world: World, tile: Tile, range: number): Tile[] {
  const tiles: Tile[] = [];
  for (let y = tile.y - range; y <= tile.y + range; y += 1) {
    for (let x = tile.x - range; x <= tile.x + range; x += 1) {
      const candidate = { x, y };
      if (Math.abs(x - tile.x) + Math.abs(y - tile.y) > range) continue;
      if (!isWalkable(world.width, world.height, world.blocked, candidate)) continue;
      tiles.push(candidate);
    }
  }
  return tiles;
}

export function inSuppressionRange(position: Vec2, fire: Entity): boolean {
  if (!fire.fire || !fire.position) return false;
  const from = tileOf(position);
  const target = tileOf(fire.position);
  return Math.abs(from.x - target.x) + Math.abs(from.y - target.y) <= fire.fire.range;
}

export function nearestReachable(world: World, from: Tile, tiles: readonly Tile[]): Tile | null {
  let best: { tile: Tile; length: number } | null = null;
  for (const tile of tiles) {
    const path = findPath(world, from, tile);
    if (!path) continue;
    if (
      !best ||
      path.length < best.length ||
      (path.length === best.length &&
        (tile.y < best.tile.y || (tile.y === best.tile.y && tile.x < best.tile.x)))
    ) {
      best = { tile, length: path.length };
    }
  }
  return best?.tile ?? null;
}

export function findStoredSuppress(
  world: World,
  origin: Tile,
): { item: EquipmentInstance; approach: Tile } | null {
  let best: { item: EquipmentInstance; approach: Tile; length: number } | null = null;
  const items = [...world.equipment.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const item of items) {
    if (item.ownerId || item.reservedByTaskId || !item.locationId || !canSuppress(world, item))
      continue;
    const storage = world.entities.get(item.locationId);
    if (!storage || !canTakeFrom(storage)) continue;
    const approach = nearestReachable(world, origin, approachTiles(world, storage));
    if (!approach) continue;
    const length = Math.abs(approach.x - origin.x) + Math.abs(approach.y - origin.y);
    if (!best || length < best.length || (length === best.length && item.id < best.item.id)) {
      best = { item, approach, length };
    }
  }
  return best ? { item: best.item, approach: best.approach } : null;
}

export function invalidSuppressReason(world: World, task: Task, from: Tile): string | null {
  if (task.kind !== 'suppress-fire') return null;
  const responder = world.entities.get(task.assigneeId);
  if (blocksPedestrian(responder)) return CommandRejection.Aboard;
  const fire = world.entities.get(task.targetId);
  if (!fire?.fire) return CommandRejection.UnknownFire;
  if (fireControlled(world, task.targetId)) return null;
  if (!carriedSuppress(world, task.assigneeId) && !reservedSuppress(world, task)) {
    return CommandRejection.NoSuppressant;
  }
  if (task.step === 'move-to' && task.approachTile && !findPath(world, from, task.approachTile)) {
    return CommandRejection.NoPath;
  }
  return null;
}

function reservedSuppress(world: World, task: SuppressFireTask): boolean {
  return task.reservations.some((id) => {
    const item = world.equipment.get(id);
    return item ? canSuppress(world, item) || (item.agent ?? 0) > 0 : false;
  });
}
