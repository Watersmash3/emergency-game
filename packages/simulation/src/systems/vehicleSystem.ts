import { FIXED_DT_MS } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { tileCenter } from '../navigation/grid.ts';
import { completeTask } from '../tasks/lifecycle.ts';
import { parkVehicle, refreshVehicleStatus, releaseTransport } from '../tasks/vehicleRules.ts';
import type { DriveVehicleTask } from '../tasks/types.ts';

export function stepVehicles(world: World): void {
  const entities = [...world.entities.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const entity of entities) {
    if (!entity.vehicle || !entity.position || !entity.movement) continue;
    const drive = runningDrive(world, entity.id);
    if (!drive) {
      if (entity.vehicle.status === 'moving') parkVehicle(world, entity.id);
      else refreshVehicleStatus(entity.vehicle);
      continue;
    }
    advanceDrive(world, entity.id, drive);
  }
  syncOccupants(world);
}

export function syncOccupants(world: World): void {
  for (const entity of world.entities.values()) {
    const vehicleId = entity.responder?.aboardVehicleId;
    if (!vehicleId || !entity.position) continue;
    const vehicle = world.entities.get(vehicleId);
    if (!vehicle?.vehicle || !vehicle.position) continue;
    const seat = Math.max(0, vehicle.vehicle.occupants.indexOf(entity.id));
    const heading = vehicle.vehicle.heading;
    const offset = (seat - (vehicle.vehicle.occupants.length - 1) / 2) * 0.22;
    entity.position.x = vehicle.position.x + -Math.sin(heading) * offset;
    entity.position.y = vehicle.position.y + Math.cos(heading) * offset;
    if (entity.movement) {
      entity.movement.path = [];
      entity.movement.destination = null;
    }
  }
}

function advanceDrive(world: World, vehicleId: string, drive: DriveVehicleTask): void {
  const entity = world.entities.get(vehicleId);
  if (!entity?.vehicle || !entity.position || !entity.movement) return;
  const lastIndex = drive.nodeIds.length - 1;
  if (drive.pathIndex >= lastIndex) {
    finishDrive(world, vehicleId, drive);
    return;
  }
  const nextId = drive.nodeIds[drive.pathIndex + 1];
  const next = nextId ? world.roadNodes.get(nextId) : undefined;
  if (!next || !nextId) {
    finishDrive(world, vehicleId, drive);
    return;
  }
  const target = tileCenter(next);
  const dx = target.x - entity.position.x;
  const dy = target.y - entity.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0) entity.vehicle.heading = Math.atan2(dy, dx);
  const step = (entity.movement.speed * FIXED_DT_MS) / 1000;
  if (distance <= step) {
    entity.position.x = target.x;
    entity.position.y = target.y;
    entity.vehicle.nodeId = nextId;
    drive.pathIndex += 1;
    if (drive.pathIndex >= lastIndex) finishDrive(world, vehicleId, drive);
    return;
  }
  entity.position.x += (dx / distance) * step;
  entity.position.y += (dy / distance) * step;
}

function finishDrive(world: World, vehicleId: string, drive: DriveVehicleTask): void {
  const entity = world.entities.get(vehicleId);
  if (!entity?.vehicle) return;
  const node = world.roadNodes.get(entity.vehicle.nodeId);
  if (node && entity.position) {
    const center = tileCenter(node);
    entity.position.x = center.x;
    entity.position.y = center.y;
  }
  entity.vehicle.status = 'idle';
  entity.vehicle.destinationNodeId = null;
  releaseTransport(world, drive.id);
  refreshVehicleStatus(entity.vehicle);
  completeTask(world, drive);
}

function runningDrive(world: World, vehicleId: string): DriveVehicleTask | undefined {
  return [...world.tasks.values()].find(
    (task): task is DriveVehicleTask =>
      task.kind === 'drive-vehicle' && task.assigneeId === vehicleId && task.state === 'running',
  );
}
