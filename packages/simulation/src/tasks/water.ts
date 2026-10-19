import type { Command, Tile } from '@emergency/protocol';

import { hoseEntityId } from '../components/hose.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { tileOf } from '../navigation/grid.ts';
import { evaluateIncidents, inSuppressionRange, nearestReachable, rangeTiles } from './fireRules.ts';
import {
  abandonTask,
  cancelTask,
  completeTask,
  countOwned,
  failTask,
  giveItem,
  isOpen,
  nextIdentifier,
  overrideWith,
  reserveItem,
  spawnInteract,
  spawnMove,
} from './lifecycle.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import { isWaterTask, type Task, type WaterTask } from './types.ts';
import { approachTiles, blocksPedestrian } from './vehicleRules.ts';
import {
  ATTACK_DEMAND,
  CONNECT_TICKS,
  PUMP_START_TICKS,
  VALVE_TICKS,
  adjacentTiles,
  attackLimit,
  findStoredHose,
  hoseFits,
  hoseForEquipment,
  nearestTile,
  placeHose,
  pumpOf,
  removeHose,
  routeOf,
  stowEquipment,
  supplyHydrant,
  takeAttackFlow,
} from './waterRules.ts';

function requireResponder(
  world: World,
  responderId: string,
): { ok: true; position: { x: number; y: number } } | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  if (blocksPedestrian(entity)) return { ok: false, reason: CommandRejection.Aboard };
  return { ok: true, position: entity.position };
}

type WaterCommand = Extract<
  Command,
  {
    type:
      | 'connect-supply'
      | 'disconnect-supply'
      | 'open-supply'
      | 'close-supply'
      | 'start-pump'
      | 'stop-pump'
      | 'deploy-attack'
      | 'operate-nozzle'
      | 'reposition-nozzle'
      | 'disconnect-attack'
      | 'establish-fire-attack';
  }
>;

export function applyWaterCommand(world: World, command: WaterCommand): CommandResult {
  switch (command.type) {
    case 'connect-supply':
      return connectSupply(world, command.responderId, command.hydrantId, command.vehicleId);
    case 'disconnect-supply':
      return disconnectSupply(world, command.responderId, command.hoseId);
    case 'open-supply':
      return valveSupply(world, command.responderId, command.hoseId, true);
    case 'close-supply':
      return valveSupply(world, command.responderId, command.hoseId, false);
    case 'start-pump':
      return changePump(world, command.responderId, command.vehicleId, true);
    case 'stop-pump':
      return changePump(world, command.responderId, command.vehicleId, false);
    case 'deploy-attack':
      return deployAttack(world, command.responderId, command.vehicleId);
    case 'operate-nozzle':
      return operateNozzle(world, command.responderId, command.hoseId, command.fireId);
    case 'reposition-nozzle':
      return repositionNozzle(world, command.responderId, command.hoseId, command.destination);
    case 'disconnect-attack':
      return disconnectAttack(world, command.responderId, command.hoseId);
    case 'establish-fire-attack':
      return establishAttack(world, command.teamId, command.incidentId);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export function advanceWaterTask(world: World, task: WaterTask): void {
  switch (task.kind) {
    case 'connect-supply':
      advanceConnect(world, task);
      break;
    case 'disconnect-supply':
      advanceDisconnectSupply(world, task);
      break;
    case 'open-supply':
    case 'close-supply':
      advanceValve(world, task);
      break;
    case 'start-pump':
    case 'stop-pump':
      advancePump(world, task);
      break;
    case 'deploy-attack':
      advanceDeploy(world, task);
      break;
    case 'operate-nozzle':
      advanceOperate(world, task);
      break;
    case 'reposition-nozzle':
      advanceReposition(world, task);
      break;
    case 'disconnect-attack':
      advanceDisconnectAttack(world, task);
      break;
    case 'establish-fire-attack':
      advanceEstablish(world, task);
      break;
    default: {
      const unreachable: never = task.kind;
      return unreachable;
    }
  }
}

function connectSupply(
  world: World,
  responderId: string,
  hydrantId: string,
  vehicleId: string,
  source: 'team' | 'individual' = 'individual',
  parentId?: string,
  role?: WaterTask['role'],
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const vehicle = world.entities.get(vehicleId);
  const hydrant = world.entities.get(hydrantId);
  if (!vehicle?.vehicle?.pump || !vehicle.position) {
    return { ok: false, reason: CommandRejection.NoPump };
  }
  if (vehicle.vehicle.status !== 'idle') {
    return { ok: false, reason: CommandRejection.EngineNotParked };
  }
  if (!hydrant?.hydrant?.available || !hydrant.position) {
    return { ok: false, reason: CommandRejection.NoHydrant };
  }
  if (hydrant.hydrant.connectionId) return { ok: false, reason: CommandRejection.AlreadyConnected };
  const stored = findStoredHose(world, vehicleId, 'supply');
  if (!stored) return { ok: false, reason: CommandRejection.NoEquipment };
  const route = routeOf(world, tileOf(hydrant.position), tileOf(vehicle.position));
  if (!route) return { ok: false, reason: CommandRejection.NoPath };
  if (!hoseFits(route, stored.maxLength)) return { ok: false, reason: CommandRejection.HoseTooShort };
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: 'connect-supply',
    assigneeId: responderId,
    source,
    targetId: vehicleId,
    step: 'acquire-move',
    equipmentId: stored.id,
    vehicleId,
    hydrantId,
    parentId,
    role,
  });
  const item = world.equipment.get(stored.id);
  if (item && item.reservedByTaskId === null) reserveItem(task, item);
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  if (item?.ownerId === responderId) task.step = 'hydrant-move';
  beginMove(world, task, item?.ownerId === responderId ? hydrantApproach(world, responder.position, hydrant) ?? approach : approach);
  return { ok: true };
}

function disconnectSupply(
  world: World,
  responderId: string,
  hoseId: string,
  source: 'team' | 'individual' = 'individual',
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const hose = world.entities.get(hoseId)?.hose;
  if (!hose || hose.kind !== 'supply' || !hose.targetId) {
    return { ok: false, reason: CommandRejection.NotConnected };
  }
  const vehicle = world.entities.get(hose.targetId);
  if (!vehicle?.position) return { ok: false, reason: CommandRejection.NoVehicle };
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: 'disconnect-supply',
    assigneeId: responderId,
    source,
    targetId: hose.targetId,
    step: 'engine-move',
    equipmentId: hose.equipmentId,
    vehicleId: hose.targetId,
    hydrantId: hose.sourceId ?? undefined,
  });
  task.hoseEntityId = hoseId;
  if (source === 'individual') overrideWith(world, responderId, task.id);
  beginMove(world, task, approach);
  return { ok: true };
}

function valveSupply(
  world: World,
  responderId: string,
  hoseId: string,
  open: boolean,
  source: 'team' | 'individual' = 'individual',
  parentId?: string,
  role?: WaterTask['role'],
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const entity = world.entities.get(hoseId);
  const hose = entity?.hose;
  if (!hose || hose.kind !== 'supply' || !hose.sourceId || !hose.targetId) {
    return { ok: false, reason: CommandRejection.NotConnected };
  }
  if (open && hose.state === 'open') return { ok: false, reason: CommandRejection.AlreadyConnected };
  if (!open && hose.state !== 'open') return { ok: false, reason: CommandRejection.SupplyClosed };
  const hydrant = world.entities.get(hose.sourceId);
  if (!hydrant?.position) return { ok: false, reason: CommandRejection.NoHydrant };
  const approach = nearestTile(world, tileOf(responder.position), adjacentTiles(world, tileOf(hydrant.position)));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: open ? 'open-supply' : 'close-supply',
    assigneeId: responderId,
    source,
    targetId: hose.sourceId,
    step: 'hydrant-move',
    equipmentId: hose.equipmentId,
    vehicleId: hose.targetId,
    hydrantId: hose.sourceId,
    parentId,
    role,
  });
  task.hoseEntityId = hoseId;
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  beginMove(world, task, approach);
  return { ok: true };
}

function changePump(
  world: World,
  responderId: string,
  vehicleId: string,
  start: boolean,
  source: 'team' | 'individual' = 'individual',
  parentId?: string,
  role?: WaterTask['role'],
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const vehicle = world.entities.get(vehicleId);
  const pump = pumpOf(vehicle);
  if (!vehicle?.vehicle || !vehicle.position || !pump) return { ok: false, reason: CommandRejection.NoPump };
  if (vehicle.vehicle.status !== 'idle') return { ok: false, reason: CommandRejection.EngineNotParked };
  if (start && (pump.state === 'operating' || pump.state === 'starting')) {
    return { ok: false, reason: CommandRejection.PumpRunning };
  }
  if (!start && pump.state !== 'operating' && pump.state !== 'starting') {
    return { ok: false, reason: CommandRejection.PumpOff };
  }
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: start ? 'start-pump' : 'stop-pump',
    assigneeId: responderId,
    source,
    targetId: vehicleId,
    step: 'engine-move',
    vehicleId,
    parentId,
    role,
  });
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  beginMove(world, task, approach);
  return { ok: true };
}

function deployAttack(
  world: World,
  responderId: string,
  vehicleId: string,
  source: 'team' | 'individual' = 'individual',
  parentId?: string,
  role?: WaterTask['role'],
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle?.pump || !vehicle.position) return { ok: false, reason: CommandRejection.NoPump };
  if (vehicle.vehicle.status !== 'idle') return { ok: false, reason: CommandRejection.EngineNotParked };
  const stored = findStoredHose(world, vehicleId, 'attack');
  if (!stored) return { ok: false, reason: CommandRejection.NoEquipment };
  if (countOwned(world, responderId) >= world.inventoryCapacity && world.equipment.get(stored.id)?.ownerId !== responderId) {
    return { ok: false, reason: CommandRejection.InventoryFull };
  }
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: 'deploy-attack',
    assigneeId: responderId,
    source,
    targetId: vehicleId,
    step: 'acquire-move',
    equipmentId: stored.id,
    vehicleId,
    parentId,
    role,
  });
  const item = world.equipment.get(stored.id);
  if (item && item.reservedByTaskId === null) reserveItem(task, item);
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  if (item?.ownerId === responderId) task.step = 'engine-interact';
  if (item?.ownerId === responderId) beginInteract(world, task, vehicleId, CONNECT_TICKS);
  else beginMove(world, task, approach);
  return { ok: true };
}

function operateNozzle(
  world: World,
  responderId: string,
  hoseId: string,
  fireId: string,
  source: 'team' | 'individual' = 'individual',
  parentId?: string,
  role?: WaterTask['role'],
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const hoseEntity = world.entities.get(hoseId);
  const hose = hoseEntity?.hose;
  if (!hose || hose.kind !== 'attack' || !hose.sourceId || !hose.targetId) {
    return { ok: false, reason: CommandRejection.NotConnected };
  }
  if (hose.operatorId && hose.operatorId !== responderId && nozzleBusy(world, hose.operatorId, hoseId)) {
    return { ok: false, reason: CommandRejection.HoseInUse };
  }
  const fire = world.entities.get(fireId);
  if (!fire?.fire || !fire.position) return { ok: false, reason: CommandRejection.UnknownFire };
  if (fire.fire.intensity <= 0) return { ok: false, reason: CommandRejection.FireOut };
  const sourceEntity = world.entities.get(hose.sourceId);
  if (!sourceEntity?.position) return { ok: false, reason: CommandRejection.NotConnected };
  const tiles = rangeTiles(world, tileOf(fire.position), fire.fire.range).filter((tile) => {
    const route = routeOf(world, tileOf(sourceEntity.position!), tile);
    return Boolean(route && hoseFits(route, hose.maxLength));
  });
  const approach = nearestReachable(world, tileOf(responder.position), tiles);
  if (!approach) return { ok: false, reason: CommandRejection.HoseTooShort };
  const task = createWaterTask(world, {
    kind: 'operate-nozzle',
    assigneeId: responderId,
    source,
    targetId: fireId,
    step: 'nozzle-move',
    equipmentId: hose.equipmentId,
    vehicleId: hose.sourceId,
    parentId,
    role,
    destination: approach,
  });
  task.hoseEntityId = hoseId;
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  hose.operatorId = responderId;
  if (inSuppressionRange(responder.position, fire) && attackLimit(world, responderId, tileOf(responder.position)) === null) {
    task.step = 'flow';
    layNozzle(world, hoseEntity, tileOf(responder.position));
  } else beginMove(world, task, approach);
  return { ok: true };
}

function repositionNozzle(
  world: World,
  responderId: string,
  hoseId: string,
  destination: Tile,
): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const hoseEntity = world.entities.get(hoseId);
  const hose = hoseEntity?.hose;
  if (!hose || hose.kind !== 'attack' || hose.operatorId !== responderId || !hose.sourceId) {
    return { ok: false, reason: CommandRejection.NotConnected };
  }
  const limit = attackLimit(world, responderId, destination);
  if (limit) return { ok: false, reason: limit };
  const task = createWaterTask(world, {
    kind: 'reposition-nozzle',
    assigneeId: responderId,
    source: 'individual',
    targetId: hose.sourceId,
    step: 'nozzle-move',
    equipmentId: hose.equipmentId,
    vehicleId: hose.sourceId,
    destination,
  });
  task.hoseEntityId = hoseId;
  overrideWith(world, responderId, task.id);
  beginMove(world, task, destination);
  return { ok: true };
}

function disconnectAttack(world: World, responderId: string, hoseId: string): CommandResult {
  const responder = requireResponder(world, responderId);
  if (!responder.ok) return responder;
  const hose = world.entities.get(hoseId)?.hose;
  if (!hose || hose.kind !== 'attack' || !hose.sourceId) {
    return { ok: false, reason: CommandRejection.NotConnected };
  }
  const vehicle = world.entities.get(hose.sourceId);
  if (!vehicle?.position) return { ok: false, reason: CommandRejection.NoVehicle };
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const task = createWaterTask(world, {
    kind: 'disconnect-attack',
    assigneeId: responderId,
    source: 'individual',
    targetId: hose.sourceId,
    step: 'engine-move',
    equipmentId: hose.equipmentId,
    vehicleId: hose.sourceId,
  });
  task.hoseEntityId = hoseId;
  overrideWith(world, responderId, task.id);
  beginMove(world, task, approach);
  return { ok: true };
}

function establishAttack(world: World, teamId: string, incidentId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const incident = world.incidents.get(incidentId);
  if (!incident) return { ok: false, reason: CommandRejection.UnknownIncident };
  if (incident.state === 'resolved') return { ok: false, reason: CommandRejection.IncidentResolved };
  const objective = [...world.objectives.values()].find(
    (candidate) => candidate.incidentId === incidentId && candidate.state === 'open',
  );
  if (!objective) return { ok: false, reason: CommandRejection.IncidentResolved };
  const vehicleId = world.team.apparatusId;
  const vehicle = vehicleId ? world.entities.get(vehicleId) : undefined;
  if (!vehicle?.vehicle?.pump || !vehicle.position) return { ok: false, reason: CommandRejection.NoPump };
  if (vehicle.vehicle.status !== 'idle') return { ok: false, reason: CommandRejection.EngineNotParked };
  if (!world.team.memberIds.some((memberId) => !world.entities.get(memberId)?.responder?.aboardVehicleId)) {
    return { ok: false, reason: CommandRejection.Aboard };
  }
  if (!findStoredHose(world, vehicle.id, 'attack') && !deployedAttack(world, vehicle.id)) {
    return { ok: false, reason: CommandRejection.NoEquipment };
  }
  const hydrant = supplyHydrant(world, vehicle);
  const task = createWaterTask(world, {
    kind: 'establish-fire-attack',
    assigneeId: incidentId,
    source: 'team',
    targetId: incidentId,
    step: 'coordinate',
    vehicleId: vehicle.id,
    hydrantId: hydrant?.id,
  });
  task.groupId = nextIdentifier(world, 'group');
  return { ok: true };
}

function advanceConnect(world: World, task: WaterTask): void {
  const context = supplyContext(world, task);
  if (!context.ok) {
    failTask(world, task, context.reason);
    return;
  }
  const existing = hoseForEquipment(world, context.item.id)?.hose;
  if (existing?.sourceId === context.hydrant.id && existing.targetId === context.vehicle.id) {
    stowEquipment(world, context.item.id, context.vehicle.id);
    completeTask(world, task);
    return;
  }
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  if (context.item.ownerId !== task.assigneeId) {
    if (task.step === 'acquire-move' && child === 'done') {
      task.step = 'acquire-interact';
      beginInteract(world, task, context.vehicle.id, CONNECT_TICKS);
      return;
    }
    if (task.step === 'acquire-interact' && child === 'done') {
      const reason = giveItem(world, task, context.item.id);
      if (reason) {
        failTask(world, task, reason);
        return;
      }
      const approach = hydrantApproach(world, context.responder.position, context.hydrant);
      if (!approach) {
        failTask(world, task, CommandRejection.NoPath);
        return;
      }
      task.step = 'hydrant-move';
      beginMove(world, task, approach);
      return;
    }
      const approach = nearestTile(world, tileOf(context.responder.position!), approachTiles(world, context.vehicle));
      if (!approach) {
        failTask(world, task, CommandRejection.NoPath);
        return;
      }
      task.step = 'acquire-move';
      beginMove(world, task, approach);
      return;
  }
  if (!existing) {
    if (task.step === 'hydrant-move' && child === 'done') {
      task.step = 'hydrant-interact';
      beginInteract(world, task, context.hydrant.id, CONNECT_TICKS);
      return;
    }
    if (task.step === 'hydrant-interact' && child === 'done') {
      const nozzle = context.hydrant.position!;
      placeHose(world, {
        equipmentId: context.item.id,
        definitionId: context.item.definitionId,
        name: world.catalog.get(context.item.definitionId)?.name ?? 'Supply hose',
        kind: 'supply',
        maxLength: world.catalog.get(context.item.definitionId)?.maxLength ?? 0,
        route: [{ x: nozzle.x, y: nozzle.y }],
        sourceId: context.hydrant.id,
        targetId: null,
        operatorId: task.assigneeId,
        state: 'connected',
      });
      context.hydrant.hydrant.connectionId = hoseEntityId(context.item.id);
      task.step = 'engine-move';
      const engineApproach = nearestTile(
        world,
        tileOf(context.responder.position),
        approachTiles(world, context.vehicle),
      );
      if (!engineApproach) {
        failTask(world, task, CommandRejection.NoPath);
        return;
      }
      beginMove(world, task, engineApproach);
      return;
    } else if (task.step !== 'hydrant-interact') {
      const approach = hydrantApproach(world, context.responder.position!, context.hydrant);
      if (!approach) {
        failTask(world, task, CommandRejection.NoPath);
        return;
      }
      task.step = 'hydrant-move';
      beginMove(world, task, approach);
      return;
    }
  }
  const hose = hoseForEquipment(world, context.item.id);
  if (!hose?.hose || hose.hose.targetId === context.vehicle.id) return;
  if (task.step === 'engine-move' && child === 'done') {
    task.step = 'engine-interact';
    beginInteract(world, task, context.vehicle.id, CONNECT_TICKS);
    return;
  }
  if (task.step === 'engine-interact' && child === 'done') {
    const route = routeOf(world, tileOf(context.hydrant.position!), tileOf(context.vehicle.position!));
    if (!route || !hoseFits(route, hose.hose.maxLength)) {
      failTask(world, task, CommandRejection.HoseTooShort);
      return;
    }
    hose.hose.route = route;
    hose.hose.targetId = context.vehicle.id;
    hose.hose.state = 'connected';
    hose.hose.operatorId = null;
    const nozzle = route[route.length - 1];
    if (nozzle) hose.position = { x: nozzle.x, y: nozzle.y };
    const pump = pumpOf(context.vehicle);
    if (pump) pump.intakeId = hose.id;
    stowEquipment(world, context.item.id, context.vehicle.id);
    completeTask(world, task);
    return;
  }
  const approach = nearestTile(world, tileOf(context.responder.position!), approachTiles(world, context.vehicle));
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  task.step = 'engine-move';
  beginMove(world, task, approach);
}

function advanceDisconnectSupply(world: World, task: WaterTask): void {
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  const hoseId = task.hoseEntityId;
  const hose = hoseId ? world.entities.get(hoseId)?.hose : undefined;
  if (!hose || !task.vehicleId) {
    completeTask(world, task);
    return;
  }
  if (task.step === 'engine-move' && child === 'done') {
    task.step = 'engine-interact';
    beginInteract(world, task, task.vehicleId, CONNECT_TICKS);
    return;
  }
  if (task.step === 'engine-interact' && child === 'done') {
    removeHose(world, hose.equipmentId);
    stowEquipment(world, hose.equipmentId, task.vehicleId);
    completeTask(world, task);
    return;
  }
  const vehicle = world.entities.get(task.vehicleId);
  const responder = world.entities.get(task.assigneeId);
  if (!vehicle || !responder?.position) {
    failTask(world, task, CommandRejection.NoVehicle);
    return;
  }
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  task.step = 'engine-move';
  beginMove(world, task, approach);
}

function advanceValve(world: World, task: WaterTask): void {
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  const hose = task.hoseEntityId ? world.entities.get(task.hoseEntityId)?.hose : undefined;
  if (!hose) {
    failTask(world, task, CommandRejection.NotConnected);
    return;
  }
  if (task.kind === 'open-supply' && hose.state === 'open') {
    completeTask(world, task);
    return;
  }
  if (task.kind === 'close-supply' && hose.state !== 'open') {
    completeTask(world, task);
    return;
  }
  if (task.step === 'hydrant-move' && child === 'done') {
    task.step = 'hydrant-interact';
    beginInteract(world, task, task.targetId, VALVE_TICKS);
    return;
  }
  if (task.step === 'hydrant-interact' && child === 'done') {
    hose.state = task.kind === 'open-supply' ? 'open' : 'connected';
    completeTask(world, task);
    return;
  }
  const hydrant = world.entities.get(task.targetId);
  const responder = world.entities.get(task.assigneeId);
  if (!hydrant?.position || !responder?.position) {
    failTask(world, task, CommandRejection.NoHydrant);
    return;
  }
  const approach = nearestTile(world, tileOf(responder.position), adjacentTiles(world, tileOf(hydrant.position)));
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  task.step = 'hydrant-move';
  beginMove(world, task, approach);
}

function advancePump(world: World, task: WaterTask): void {
  const vehicle = task.vehicleId ? world.entities.get(task.vehicleId) : undefined;
  const pump = pumpOf(vehicle);
  if (!vehicle?.vehicle || !pump) {
    failTask(world, task, CommandRejection.NoPump);
    return;
  }
  if (vehicle.vehicle.status !== 'idle') {
    failTask(world, task, CommandRejection.EngineNotParked);
    return;
  }
  if (task.kind === 'start-pump' && pump.state === 'operating') {
    completeTask(world, task);
    return;
  }
  if (task.kind === 'stop-pump' && pump.state === 'off') {
    completeTask(world, task);
    return;
  }
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  if (task.step === 'engine-move' && child === 'done') {
    task.step = 'engine-interact';
    if (task.kind === 'start-pump') pump.state = 'starting';
    beginInteract(world, task, vehicle.id, task.kind === 'start-pump' ? PUMP_START_TICKS : VALVE_TICKS);
    return;
  }
  if (task.step === 'engine-interact' && child === 'done') {
    if (task.kind === 'start-pump') {
      pump.state = 'operating';
      pump.pressure = 1;
    } else {
      pump.state = 'off';
      pump.pressure = 0;
    }
    completeTask(world, task);
    return;
  }
  const responder = world.entities.get(task.assigneeId);
  if (!responder?.position) {
    failTask(world, task, CommandRejection.UnknownResponder);
    return;
  }
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  task.step = 'engine-move';
  beginMove(world, task, approach);
}

function advanceDeploy(world: World, task: WaterTask): void {
  const vehicle = task.vehicleId ? world.entities.get(task.vehicleId) : undefined;
  const item = task.equipmentId ? world.equipment.get(task.equipmentId) : undefined;
  if (!vehicle?.vehicle?.pump || !vehicle.position || !item) {
    failTask(world, task, CommandRejection.NoEquipment);
    return;
  }
  const existing = hoseForEquipment(world, item.id)?.hose;
  if (existing?.kind === 'attack' && existing.targetId === vehicle.id) {
    stowEquipment(world, item.id, vehicle.id);
    completeTask(world, task);
    return;
  }
  if (vehicle.vehicle.status !== 'idle') {
    failTask(world, task, CommandRejection.EngineNotParked);
    return;
  }
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  const responder = world.entities.get(task.assigneeId);
  if (!responder?.position) {
    failTask(world, task, CommandRejection.UnknownResponder);
    return;
  }
  if (item.ownerId !== task.assigneeId) {
    if (task.step === 'acquire-move' && child === 'done') {
      task.step = 'acquire-interact';
      beginInteract(world, task, vehicle.id, CONNECT_TICKS);
      return;
    }
    if (task.step === 'acquire-interact' && child === 'done') {
      const reason = giveItem(world, task, item.id);
      if (reason) {
        failTask(world, task, reason);
        return;
      }
      task.step = 'engine-interact';
      beginInteract(world, task, vehicle.id, CONNECT_TICKS);
      return;
    }
    const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
    if (!approach) {
      failTask(world, task, CommandRejection.NoPath);
      return;
    }
    task.step = 'acquire-move';
    beginMove(world, task, approach);
    return;
  }
  if (task.step === 'engine-interact' && child === 'done') {
    const origin = vehicle.position;
    const definition = world.catalog.get(item.definitionId);
    const hose = placeHose(world, {
      equipmentId: item.id,
      definitionId: item.definitionId,
      name: definition?.name ?? 'Attack hose',
      kind: 'attack',
      maxLength: definition?.maxLength ?? 0,
      route: [{ x: origin.x, y: origin.y }],
      sourceId: vehicle.id,
      targetId: vehicle.id,
      operatorId: task.assigneeId,
      state: 'connected',
    });
    const pump = pumpOf(vehicle);
    if (pump && !pump.discharges.includes(hose.id)) pump.discharges.push(hose.id);
    stowEquipment(world, item.id, vehicle.id);
    task.hoseEntityId = hose.id;
    completeTask(world, task);
    return;
  }
  task.step = 'engine-interact';
  beginInteract(world, task, vehicle.id, CONNECT_TICKS);
}

function advanceOperate(world: World, task: WaterTask): void {
  const responder = world.entities.get(task.assigneeId);
  const fire = world.entities.get(task.targetId);
  const hoseEntity = task.hoseEntityId ? world.entities.get(task.hoseEntityId) : undefined;
  const hose = hoseEntity?.hose;
  if (!responder?.position || !responder.responder || !fire?.fire || !fire.position || !hose) {
    failTask(world, task, CommandRejection.NotConnected);
    return;
  }
  if (blocksPedestrian(responder)) {
    failTask(world, task, CommandRejection.Aboard);
    return;
  }
  if (hose.operatorId && hose.operatorId !== task.assigneeId) {
    completeTask(world, task);
    return;
  }
  hose.operatorId = task.assigneeId;
  if (fire.fire.intensity <= 0) {
    evaluateIncidents(world);
    hose.flow = 0;
    completeTask(world, task);
    return;
  }
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  if (!inSuppressionRange(responder.position, fire)) {
    const source = hose.sourceId ? world.entities.get(hose.sourceId) : undefined;
    if (!source?.position) {
      failTask(world, task, CommandRejection.NotConnected);
      return;
    }
    const tiles = rangeTiles(world, tileOf(fire.position), fire.fire.range).filter((tile) => {
      const route = routeOf(world, tileOf(source.position!), tile);
      return Boolean(route && hoseFits(route, hose.maxLength));
    });
    const approach = nearestReachable(world, tileOf(responder.position), tiles);
    if (!approach) {
      failTask(world, task, CommandRejection.HoseTooShort);
      return;
    }
    task.destination = approach;
    task.step = 'nozzle-move';
    beginMove(world, task, approach);
    return;
  }
  if (task.step === 'nozzle-move' && child === 'done') layNozzle(world, hoseEntity!, tileOf(responder.position));
  else if (task.step !== 'flow') layNozzle(world, hoseEntity!, tileOf(responder.position));
  task.step = 'flow';
  const vehicleId = hose.sourceId;
  if (!vehicleId) {
    hose.flow = 0;
    return;
  }
  const amount = takeAttackFlow(world, vehicleId, ATTACK_DEMAND);
  hose.flow = amount;
  if (amount <= 0) return;
  const rate = world.catalog.get(hose.definitionId)?.suppression ?? 0;
  fire.fire.intensity = Math.max(0, fire.fire.intensity - rate * amount);
  task.progressTicks += 1;
  if (fire.fire.intensity <= 0) {
    evaluateIncidents(world);
    completeTask(world, task);
  }
}

function advanceReposition(world: World, task: WaterTask): void {
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  const hoseEntity = task.hoseEntityId ? world.entities.get(task.hoseEntityId) : undefined;
  if (!hoseEntity?.hose || !task.destination) {
    failTask(world, task, CommandRejection.NotConnected);
    return;
  }
  if (child === 'done') {
    layNozzle(world, hoseEntity, task.destination);
    completeTask(world, task);
    return;
  }
  beginMove(world, task, task.destination);
}

function advanceDisconnectAttack(world: World, task: WaterTask): void {
  const child = childOf(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.failed);
    return;
  }
  const hose = task.hoseEntityId ? world.entities.get(task.hoseEntityId)?.hose : undefined;
  if (!hose || !task.vehicleId) {
    completeTask(world, task);
    return;
  }
  if (task.step === 'engine-move' && child === 'done') {
    task.step = 'engine-interact';
    beginInteract(world, task, task.vehicleId, CONNECT_TICKS);
    return;
  }
  if (task.step === 'engine-interact' && child === 'done') {
    removeHose(world, hose.equipmentId);
    stowEquipment(world, hose.equipmentId, task.vehicleId);
    completeTask(world, task);
    return;
  }
  const vehicle = world.entities.get(task.vehicleId);
  const responder = world.entities.get(task.assigneeId);
  if (!vehicle || !responder?.position) {
    failTask(world, task, CommandRejection.NoVehicle);
    return;
  }
  const approach = nearestTile(world, tileOf(responder.position), approachTiles(world, vehicle));
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  task.step = 'engine-move';
  beginMove(world, task, approach);
}

function advanceEstablish(world: World, task: WaterTask): void {
  evaluateIncidents(world);
  const incident = world.incidents.get(task.targetId);
  if (!incident) {
    failTask(world, task, CommandRejection.UnknownIncident);
    return;
  }
  if (incident.state === 'resolved') {
    completeTask(world, task);
    return;
  }
  const vehicle = task.vehicleId ? world.entities.get(task.vehicleId) : undefined;
  if (!vehicle?.vehicle?.pump || vehicle.vehicle.status !== 'idle') {
    failTask(world, task, CommandRejection.EngineNotParked);
    return;
  }
  const objective = [...world.objectives.values()].find(
    (candidate) => candidate.incidentId === incident.id && candidate.state === 'open',
  );
  if (!objective) {
    completeTask(world, task);
    return;
  }
  const children = [...world.tasks.values()].filter(
    (candidate): candidate is WaterTask => candidate.parentId === task.id && isWaterTask(candidate),
  );
  const failed = children.find((child) => child.state === 'failed' && child.role);
  if (failed?.failureReason && !roleSatisfied(world, task, failed.role, objective.targetId)) {
    failTask(world, task, failed.failureReason);
    return;
  }
  if (task.hydrantId) ensureSupply(world, task, children);
  ensurePump(world, task, children);
  ensureAttack(world, task, children, objective.targetId);
}

function roleOpen(children: WaterTask[], role: WaterTask['role']): boolean {
  return children.some(
    (child) =>
      child.role === role &&
      (child.state === 'running' || child.state === 'pending' || child.state === 'ready'),
  );
}

function claimRole(world: World, parentId: string, children: WaterTask[], role: WaterTask['role']): string | null {
  const memberId = freeMember(world, parentId);
  if (!memberId) return null;
  for (const child of children) {
    if (child.role === role && child.state === 'suspended') abandonTask(world, child);
  }
  cancelForeignTeam(world, memberId, parentId);
  return memberId;
}

function ensureSupply(world: World, parent: WaterTask, children: WaterTask[]): void {
  if (!parent.hydrantId || !parent.vehicleId) return;
  const hose = deployedSupply(world, parent.vehicleId, parent.hydrantId);
  if (hose?.hose?.state === 'open') return;
  if (roleOpen(children, 'supply')) return;
  const memberId = claimRole(world, parent.id, children, 'supply');
  if (!memberId) return;
  const current = deployedSupply(world, parent.vehicleId, parent.hydrantId);
  if (!current) {
    connectSupply(world, memberId, parent.hydrantId, parent.vehicleId, 'team', parent.id, 'supply');
    return;
  }
  valveSupply(world, memberId, current.id, true, 'team', parent.id, 'supply');
}

function ensurePump(world: World, parent: WaterTask, children: WaterTask[]): void {
  if (!parent.vehicleId) return;
  const pump = pumpOf(world.entities.get(parent.vehicleId));
  if (!pump || pump.state === 'operating' || pump.state === 'starting') return;
  if (roleOpen(children, 'pump')) return;
  const memberId = claimRole(world, parent.id, children, 'pump');
  if (!memberId) return;
  changePump(world, memberId, parent.vehicleId, true, 'team', parent.id, 'pump');
}

function ensureAttack(world: World, parent: WaterTask, children: WaterTask[], fireId: string): void {
  if (!parent.vehicleId) return;
  if (roleOpen(children, 'attack')) return;
  const memberId = claimRole(world, parent.id, children, 'attack');
  if (!memberId) return;
  const hose = deployedAttack(world, parent.vehicleId);
  if (!hose?.hose) {
    deployAttack(world, memberId, parent.vehicleId, 'team', parent.id, 'attack');
    return;
  }
  hose.hose.operatorId = memberId;
  operateNozzle(world, memberId, hose.id, fireId, 'team', parent.id, 'attack');
}

function roleSatisfied(
  world: World,
  parent: WaterTask,
  role: WaterTask['role'],
  fireId: string,
): boolean {
  if (role === 'supply') {
    return deployedSupply(world, parent.vehicleId ?? '', parent.hydrantId ?? '')?.hose?.state === 'open';
  }
  if (role === 'pump') return pumpOf(world.entities.get(parent.vehicleId ?? ''))?.state === 'operating';
  if (role === 'attack') return (world.entities.get(fireId)?.fire?.intensity ?? 1) <= 0;
  return false;
}

function freeMember(world: World, parentId: string): string | null {
  for (const memberId of world.team.memberIds) {
    if (world.entities.get(memberId)?.responder?.aboardVehicleId) continue;
    const busy = [...world.tasks.values()].some((task) => {
      if (task.assigneeId !== memberId || !isOpen(task.state)) return false;
      if (task.id === parentId || task.parentId === parentId) return true;
      if (task.source === 'individual') return true;
      return Boolean(task.parentId && task.parentId !== parentId);
    });
    if (!busy) return memberId;
  }
  return null;
}

function cancelForeignTeam(world: World, memberId: string, parentId: string): void {
  for (const task of [...world.tasks.values()]) {
    if (
      task.assigneeId === memberId &&
      !task.parentId &&
      task.id !== parentId &&
      task.source === 'team' &&
      isOpen(task.state)
    ) {
      cancelTask(world, task);
    }
  }
}

function deployedSupply(world: World, vehicleId: string, hydrantId: string): Entity | undefined {
  return [...world.entities.values()].find(
    (entity) =>
      entity.hose?.kind === 'supply' &&
      entity.hose.targetId === vehicleId &&
      entity.hose.sourceId === hydrantId,
  );
}

function deployedAttack(world: World, vehicleId: string): Entity | undefined {
  return [...world.entities.values()].find(
    (entity) => entity.hose?.kind === 'attack' && entity.hose.sourceId === vehicleId && entity.hose.targetId === vehicleId,
  );
}

function nozzleBusy(world: World, responderId: string, hoseId: string): boolean {
  return [...world.tasks.values()].some(
    (task) =>
      task.kind === 'operate-nozzle' &&
      task.assigneeId === responderId &&
      task.hoseEntityId === hoseId &&
      task.state === 'running',
  );
}

function layNozzle(world: World, hoseEntity: Entity, tile: Tile): void {
  const hose = hoseEntity.hose;
  const source = hose?.sourceId ? world.entities.get(hose.sourceId) : undefined;
  if (!hose || !source?.position) return;
  const route = routeOf(world, tileOf(source.position), tile);
  if (!route) return;
  hose.route = route;
  const nozzle = route[route.length - 1];
  if (nozzle) hoseEntity.position = { x: nozzle.x, y: nozzle.y };
}

function hydrantApproach(world: World, position: { x: number; y: number }, hydrant: Entity): Tile | null {
  if (!hydrant.position || !hydrant.hydrant) return null;
  const tiles = hydrant.hydrant.interactionTiles.length
    ? hydrant.hydrant.interactionTiles
    : adjacentTiles(world, tileOf(hydrant.position));
  return nearestTile(world, tileOf(position), tiles);
}

function supplyContext(
  world: World,
  task: WaterTask,
):
  | {
      ok: true;
      responder: Entity & { position: { x: number; y: number } };
      vehicle: Entity & { position: { x: number; y: number } };
      hydrant: Entity & { position: { x: number; y: number }; hydrant: NonNullable<Entity['hydrant']> };
      item: NonNullable<ReturnType<World['equipment']['get']>>;
    }
  | { ok: false; reason: string } {
  const responder = world.entities.get(task.assigneeId);
  const vehicle = task.vehicleId ? world.entities.get(task.vehicleId) : undefined;
  const hydrant = task.hydrantId ? world.entities.get(task.hydrantId) : undefined;
  const item = task.equipmentId ? world.equipment.get(task.equipmentId) : undefined;
  if (!responder?.responder || !responder.position) return { ok: false, reason: CommandRejection.UnknownResponder };
  if (blocksPedestrian(responder)) return { ok: false, reason: CommandRejection.Aboard };
  if (!vehicle?.vehicle?.pump || !vehicle.position) return { ok: false, reason: CommandRejection.NoPump };
  if (!hydrant?.hydrant || !hydrant.position) return { ok: false, reason: CommandRejection.NoHydrant };
  if (!item) return { ok: false, reason: CommandRejection.NoEquipment };
  const responderPosition = responder.position;
  const vehiclePosition = vehicle.position;
  const hydrantPosition = hydrant.position;
  const hydrantComponent = hydrant.hydrant;
  return {
    ok: true,
    responder: { ...responder, position: responderPosition },
    vehicle: { ...vehicle, position: vehiclePosition },
    hydrant: { ...hydrant, position: hydrantPosition, hydrant: hydrantComponent },
    item,
  };
}

function createWaterTask(
  world: World,
  input: {
    kind: WaterTask['kind'];
    assigneeId: string;
    source: 'team' | 'individual';
    targetId: string;
    step: string;
    equipmentId?: string;
    vehicleId?: string;
    hydrantId?: string;
    parentId?: string;
    role?: WaterTask['role'];
    destination?: Tile;
  },
): WaterTask {
  const task: WaterTask = {
    id: nextIdentifier(world, 'task'),
    kind: input.kind,
    state: 'pending',
    assigneeId: input.assigneeId,
    source: input.source,
    targetId: input.targetId,
    step: input.step,
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (input.equipmentId) task.equipmentId = input.equipmentId;
  if (input.vehicleId) task.vehicleId = input.vehicleId;
  if (input.hydrantId) task.hydrantId = input.hydrantId;
  if (input.parentId) task.parentId = input.parentId;
  if (input.role) task.role = input.role;
  if (input.destination) task.destination = { ...input.destination };
  const parent = input.parentId ? world.tasks.get(input.parentId) : undefined;
  if (parent?.groupId) task.groupId = parent.groupId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  if (parent && parent.kind !== 'move' && parent.kind !== 'interact') parent.childTaskId = task.id;
  return task;
}

function beginMove(world: World, task: WaterTask, destination: Tile): void {
  const step = task.step;
  spawnMove(world, task, destination);
  task.step = step;
}

function beginInteract(world: World, task: WaterTask, targetId: string, duration: number): void {
  const step = task.step;
  task.targetId = targetId;
  spawnInteract(world, task, 'operate', duration);
  task.step = step;
}

type ChildView = 'none' | 'wait' | 'suspended' | 'done' | { failed: string };

function childOf(world: World, task: WaterTask): ChildView {
  if (!task.childTaskId) return 'none';
  const child = world.tasks.get(task.childTaskId);
  if (!child) return 'none';
  if (child.state === 'running' || child.state === 'pending' || child.state === 'ready') return 'wait';
  if (child.state === 'suspended') return 'suspended';
  if (child.state === 'failed' || child.state === 'cancelled') {
    return { failed: child.failureReason ?? CommandRejection.Cancelled };
  }
  return 'done';
}

export function isRunningWater(task: Task): task is WaterTask {
  return (
    task.kind === 'connect-supply' ||
    task.kind === 'disconnect-supply' ||
    task.kind === 'open-supply' ||
    task.kind === 'close-supply' ||
    task.kind === 'start-pump' ||
    task.kind === 'stop-pump' ||
    task.kind === 'deploy-attack' ||
    task.kind === 'operate-nozzle' ||
    task.kind === 'reposition-nozzle' ||
    task.kind === 'disconnect-attack' ||
    task.kind === 'establish-fire-attack'
  );
}
