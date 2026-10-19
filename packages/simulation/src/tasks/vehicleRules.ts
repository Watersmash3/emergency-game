import type { Tile } from '@emergency/protocol';

import type { Vehicle } from '../components/vehicle.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { isWalkable, tileCenter, tileKey, tileOf } from '../navigation/grid.ts';
import { CommandRejection } from './results.ts';
import type { Task } from './types.ts';

export function seatsUsed(vehicle: Vehicle): number {
  return vehicle.occupants.length + vehicle.seatReservations.length;
}

export function reserveSeat(vehicle: Vehicle, responderId: string, taskId: string): boolean {
  if (vehicle.occupants.includes(responderId)) return true;
  if (vehicle.seatReservations.some((seat) => seat.taskId === taskId)) return true;
  if (vehicle.seatReservations.some((seat) => seat.responderId === responderId)) return true;
  if (seatsUsed(vehicle) >= vehicle.capacity) return false;
  vehicle.seatReservations.push({ responderId, taskId });
  return true;
}

export function releaseTransport(world: World, taskId: string): void {
  for (const entity of world.entities.values()) {
    if (!entity.vehicle) continue;
    entity.vehicle.seatReservations = entity.vehicle.seatReservations.filter(
      (seat) => seat.taskId !== taskId,
    );
  }
  for (const [nodeId, reservedBy] of world.reservedNodes) {
    if (reservedBy === taskId) world.reservedNodes.delete(nodeId);
  }
  for (const [tile, reservedBy] of world.reservedExits) {
    if (reservedBy === taskId) world.reservedExits.delete(tile);
  }
}

export function reserveExit(world: World, tile: Tile, taskId: string): boolean {
  const key = tileKey(tile);
  const existing = world.reservedExits.get(key);
  if (existing && existing !== taskId) return false;
  world.reservedExits.set(key, taskId);
  return true;
}

export function reserveNode(world: World, nodeId: string, taskId: string): boolean {
  const existing = world.reservedNodes.get(nodeId);
  if (existing && existing !== taskId) return false;
  world.reservedNodes.set(nodeId, taskId);
  return true;
}

export function tilesAround(world: World, tile: Tile): Tile[] {
  const candidates = [
    { x: tile.x, y: tile.y },
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ];
  return candidates.filter((candidate) =>
    isWalkable(world.width, world.height, world.blocked, candidate),
  );
}

export function approachTiles(world: World, entity: Entity): Tile[] {
  if (entity.interactable) return entity.interactable.interactionTiles;
  if (entity.hydrant) return entity.hydrant.interactionTiles;
  if (entity.vehicle && entity.position) return tilesAround(world, tileOf(entity.position));
  return [];
}

export function blocksPedestrian(entity: Entity | undefined): string | null {
  if (entity?.responder?.aboardVehicleId) return CommandRejection.Aboard;
  return null;
}

export function canTakeFrom(entity: Entity | undefined): boolean {
  if (!entity) return false;
  if (entity.interactable?.objectType === 'locker') return true;
  return Boolean(entity.vehicle && entity.vehicle.status !== 'moving');
}

export function vehicleInvalidReason(world: World, task: Task): string | null {
  if (task.kind === 'move' || task.kind === 'interact' || task.kind === 'retrieve-equipment') {
    return null;
  }
  if (task.kind === 'force-door' || task.kind === 'operate-panel') return null;
  const vehicle = world.entities.get(task.targetId);
  if (!vehicle?.vehicle) return CommandRejection.NoVehicle;
  if (task.kind === 'board-vehicle') {
    const responder = world.entities.get(task.assigneeId);
    if (responder?.responder?.aboardVehicleId === vehicle.id) return null;
    if (vehicle.vehicle.status === 'moving') return CommandRejection.VehicleMoving;
    const held = vehicle.vehicle.seatReservations.some((seat) => seat.taskId === task.id);
    if (
      !held &&
      !vehicle.vehicle.occupants.includes(task.assigneeId) &&
      seatsUsed(vehicle.vehicle) >= vehicle.vehicle.capacity
    ) {
      return CommandRejection.Full;
    }
    if (
      task.step === 'move-to' &&
      task.approachTile &&
      responder?.position &&
      !findPath(world, tileOf(responder.position), task.approachTile)
    ) {
      return CommandRejection.NoPath;
    }
    return null;
  }
  if (task.kind === 'exit-vehicle') {
    if (vehicle.vehicle.status === 'moving') return CommandRejection.VehicleMoving;
    const responder = world.entities.get(task.assigneeId);
    if (responder?.responder?.aboardVehicleId !== vehicle.id) return CommandRejection.NotAboard;
    return null;
  }
  if (task.kind === 'drive-vehicle' || task.kind === 'respond') {
    if (!vehicle.vehicle.occupants.includes(vehicle.vehicle.designatedDriverId)) {
      return CommandRejection.NoDriver;
    }
    return null;
  }
  return null;
}

export function refreshVehicleStatus(vehicle: Vehicle): void {
  if (vehicle.status === 'moving') return;
  vehicle.status = vehicle.seatReservations.length > 0 ? 'boarding' : 'idle';
}

export function parkVehicle(world: World, vehicleId: string): void {
  const entity = world.entities.get(vehicleId);
  if (!entity?.vehicle || !entity.position) return;
  const node = world.roadNodes.get(entity.vehicle.nodeId);
  if (node) {
    const center = tileCenter(node);
    entity.position.x = center.x;
    entity.position.y = center.y;
  }
  entity.vehicle.status = 'idle';
  entity.vehicle.destinationNodeId = null;
  refreshVehicleStatus(entity.vehicle);
}
