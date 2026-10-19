import type { Tile, Vec2 } from '@emergency/protocol';

import type { Pump } from '../components/pump.ts';
import { hoseEntityId, type Hose } from '../components/hose.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { isWalkable, manhattan, tileCenter, tileOf } from '../navigation/grid.ts';
import { CommandRejection } from './results.ts';
import type { Task } from './types.ts';

export const CONNECT_TICKS = 10;
export const PUMP_START_TICKS = 16;
export const VALVE_TICKS = 8;
export const ATTACK_DEMAND = 1;

export function adjacentTiles(world: World, tile: Tile): Tile[] {
  return [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ].filter((candidate) => isWalkable(world.width, world.height, world.blocked, candidate));
}

export function nearestTile(world: World, origin: Tile, tiles: Tile[]): Tile | null {
  const choices = tiles
    .filter((tile) => findPath(world, origin, tile))
    .sort(
      (left, right) =>
        manhattan(origin, left) - manhattan(origin, right) ||
        left.y - right.y ||
        left.x - right.x,
    );
  return choices[0] ?? null;
}

export function routeOf(world: World, from: Tile, to: Tile): Vec2[] | null {
  const path = findPath(world, from, to);
  if (!path) return null;
  return path.map((tile) => tileCenter(tile));
}

export function routeLength(route: Vec2[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const next = route[index];
    if (!previous || !next) continue;
    total += Math.hypot(next.x - previous.x, next.y - previous.y);
  }
  return total;
}

export function hoseFits(route: Vec2[], maxLength: number): boolean {
  return routeLength(route) <= maxLength + 1e-6;
}

export function attackLimit(world: World, responderId: string, destination: Tile): string | null {
  for (const entity of world.entities.values()) {
    const hose = entity.hose;
    if (!hose || hose.kind !== 'attack' || hose.operatorId !== responderId || !hose.sourceId) {
      continue;
    }
    const source = world.entities.get(hose.sourceId);
    if (!source?.position) return CommandRejection.NotConnected;
    const route = routeOf(world, tileOf(source.position), destination);
    if (!route) return CommandRejection.NoPath;
    if (!hoseFits(route, hose.maxLength)) return CommandRejection.HoseTooShort;
  }
  return null;
}

export function pumpOf(entity: Entity | undefined): Pump | null {
  return entity?.vehicle?.pump ?? null;
}

export function findStoredHose(
  world: World,
  vehicleId: string,
  capability: 'supply' | 'attack',
): { id: string; definitionId: string; maxLength: number; name: string } | null {
  const choices = [...world.equipment.values()]
    .filter((item) => item.locationId === vehicleId && item.ownerId === null)
    .filter((item) => {
      const definition = world.catalog.get(item.definitionId);
      return Boolean(definition?.capabilities.includes(capability) && definition.maxLength);
    })
    .filter((item) => !world.entities.has(hoseEntityId(item.id)))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const item = choices[0];
  if (!item) return null;
  const definition = world.catalog.get(item.definitionId);
  if (!definition?.maxLength) return null;
  return {
    id: item.id,
    definitionId: item.definitionId,
    maxLength: definition.maxLength,
    name: definition.name,
  };
}

export function hoseForEquipment(world: World, equipmentId: string): Entity | undefined {
  return world.entities.get(hoseEntityId(equipmentId));
}

export function placeHose(
  world: World,
  input: {
    equipmentId: string;
    definitionId: string;
    name: string;
    kind: Hose['kind'];
    maxLength: number;
    route: Vec2[];
    sourceId: string | null;
    targetId: string | null;
    operatorId: string | null;
    state: Hose['state'];
  },
): Entity {
  const id = hoseEntityId(input.equipmentId);
  const existing = world.entities.get(id);
  const nozzle = input.route[input.route.length - 1] ?? { x: 0, y: 0 };
  const hose: Hose = {
    kind: input.kind,
    name: input.name,
    definitionId: input.definitionId,
    equipmentId: input.equipmentId,
    maxLength: input.maxLength,
    route: input.route.map((point) => ({ x: point.x, y: point.y })),
    state: input.state,
    sourceId: input.sourceId,
    targetId: input.targetId,
    operatorId: input.operatorId,
    flow: 0,
  };
  if (existing) {
    existing.position = { x: nozzle.x, y: nozzle.y };
    existing.hose = hose;
    return existing;
  }
  const created: Entity = { id, position: { x: nozzle.x, y: nozzle.y }, hose };
  world.entities.set(id, created);
  return created;
}

export function removeHose(world: World, equipmentId: string): void {
  const id = hoseEntityId(equipmentId);
  const hose = world.entities.get(id)?.hose;
  if (hose?.sourceId) {
    const source = world.entities.get(hose.sourceId);
    if (source?.hydrant?.connectionId === id) source.hydrant.connectionId = null;
    if (source?.vehicle?.pump?.intakeId === id) source.vehicle.pump.intakeId = null;
  }
  if (hose?.targetId) {
    const target = world.entities.get(hose.targetId);
    const pump = target?.vehicle?.pump;
    if (pump?.intakeId === id) pump.intakeId = null;
    if (pump) pump.discharges = pump.discharges.filter((discharge) => discharge !== id);
  }
  for (const entity of world.entities.values()) {
    const pump = entity.vehicle?.pump;
    if (!pump) continue;
    if (pump.intakeId === id) pump.intakeId = null;
    pump.discharges = pump.discharges.filter((discharge) => discharge !== id);
  }
  world.entities.delete(id);
}

export function stowEquipment(world: World, equipmentId: string, vehicleId: string): void {
  const item = world.equipment.get(equipmentId);
  if (!item) return;
  item.ownerId = null;
  item.locationId = vehicleId;
  item.reservedByTaskId = null;
  for (const task of world.tasks.values()) {
    task.reservations = task.reservations.filter((id) => id !== equipmentId);
  }
}

export function cleanupWaterTask(world: World, task: Task): void {
  if (task.kind === 'start-pump' && task.vehicleId) {
    const pump = pumpOf(world.entities.get(task.vehicleId));
    if (pump?.state === 'starting') {
      pump.state = 'off';
      pump.pressure = 0;
    }
  }
  if ((task.kind === 'connect-supply' || task.kind === 'deploy-attack') && task.equipmentId) {
    const hose = hoseForEquipment(world, task.equipmentId)?.hose;
    const partialSupply = task.kind === 'connect-supply' && (!hose || hose.targetId === null);
    const partialAttack = task.kind === 'deploy-attack' && hose?.kind === 'attack' && !hose.targetId;
    if (partialSupply || partialAttack) {
      removeHose(world, task.equipmentId);
      if (task.vehicleId) stowEquipment(world, task.equipmentId, task.vehicleId);
    }
  }
}

export function takeAttackFlow(world: World, vehicleId: string, demand: number): number {
  const pump = pumpOf(world.entities.get(vehicleId));
  if (!pump || pump.state !== 'operating') return 0;
  const amount = Math.min(demand, pump.tank, Math.max(0, pump.maxDelivery - pump.delivered));
  if (amount <= 0) return 0;
  pump.tank -= amount;
  pump.delivered += amount;
  return amount;
}

export function supplyHydrant(world: World, vehicle: Entity): Entity | null {
  const pump = pumpOf(vehicle);
  if (!pump || !vehicle.position) return null;
  let best: { entity: Entity; length: number } | null = null;
  const origin = tileOf(vehicle.position);
  for (const entity of world.entities.values()) {
    if (!entity.hydrant?.available || !entity.position || entity.hydrant.connectionId) continue;
    const route = routeOf(world, tileOf(entity.position), origin);
    if (!route) continue;
    const sample = findStoredHose(world, vehicle.id, 'supply');
    const maxLength = sample?.maxLength ?? 0;
    if (!sample || !hoseFits(route, maxLength)) continue;
    const length = routeLength(route);
    if (!best || length < best.length || (length === best.length && entity.id < best.entity.id)) {
      best = { entity, length };
    }
  }
  return best?.entity ?? null;
}
