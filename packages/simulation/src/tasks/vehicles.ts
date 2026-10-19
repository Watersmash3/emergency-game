import type { Command, Tile } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { tileCenter, tileKey, tileOf } from '../navigation/grid.ts';
import { findRoadPath } from '../navigation/road.ts';
import {
  cancelTask,
  clearRoute,
  completeTask,
  failTask,
  isOpen,
  nearestApproach,
  nextIdentifier,
  overrideWith,
  spawnInteract,
  spawnMove,
} from './lifecycle.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type {
  BoardVehicleTask,
  DriveVehicleTask,
  ExitVehicleTask,
  RespondTask,
  Task,
} from './types.ts';
import {
  refreshVehicleStatus,
  releaseTransport,
  reserveExit,
  reserveNode,
  reserveSeat,
  tilesAround,
} from './vehicleRules.ts';

const BOARD_TICKS = 10;
const EXIT_TICKS = 10;

type VehicleCommand = Extract<
  Command,
  {
    type:
      | 'board-vehicle'
      | 'exit-vehicle'
      | 'board-team'
      | 'disembark-team'
      | 'drive-vehicle'
      | 'respond-to';
  }
>;

export function applyVehicleCommand(world: World, command: VehicleCommand): CommandResult {
  switch (command.type) {
    case 'board-vehicle':
      return boardVehicle(world, command.responderId, command.vehicleId, 'individual');
    case 'exit-vehicle':
      return exitVehicle(world, command.responderId, command.vehicleId, 'individual');
    case 'board-team':
      return boardTeam(world, command.teamId, command.vehicleId);
    case 'disembark-team':
      return disembarkTeam(world, command.teamId, command.vehicleId);
    case 'drive-vehicle':
      return driveVehicle(world, command.vehicleId, command.destinationNodeId);
    case 'respond-to':
      return respondTo(world, command.teamId, command.destinationNodeId, command.disembark);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export function advanceVehicleTask(world: World, task: Task): void {
  switch (task.kind) {
    case 'board-vehicle':
      advanceBoard(world, task);
      break;
    case 'exit-vehicle':
      advanceExit(world, task);
      break;
    case 'respond':
      advanceRespond(world, task);
      break;
    case 'drive-vehicle':
      break;
    default:
      break;
  }
}

function boardVehicle(
  world: World,
  responderId: string,
  vehicleId: string,
  source: 'team' | 'individual',
  groupId?: string,
  parentId?: string,
): CommandResult {
  if (openCrewTask(world, responderId, 'board-vehicle')) return { ok: true };
  const planned = planBoard(world, responderId, vehicleId);
  if (!planned.ok) return planned;
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle) return { ok: false, reason: CommandRejection.NoVehicle };

  const task: BoardVehicleTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'board-vehicle',
    state: 'pending',
    assigneeId: responderId,
    source,
    targetId: vehicleId,
    step: 'move-to',
    approachTile: { ...planned.approach },
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (groupId) task.groupId = groupId;
  if (parentId) task.parentId = parentId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  if (!reserveSeat(vehicle.vehicle, responderId, task.id)) {
    failTask(world, task, CommandRejection.Full);
    return { ok: false, reason: CommandRejection.Full };
  }
  refreshVehicleStatus(vehicle.vehicle);
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  spawnMove(world, task, planned.approach);
  return { ok: true };
}

function exitVehicle(
  world: World,
  responderId: string,
  vehicleId: string,
  source: 'team' | 'individual',
  groupId?: string,
  parentId?: string,
): CommandResult {
  if (openCrewTask(world, responderId, 'exit-vehicle')) return { ok: true };
  const planned = planExit(world, responderId, vehicleId);
  if (!planned.ok) return planned;

  const task: ExitVehicleTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'exit-vehicle',
    state: 'pending',
    assigneeId: responderId,
    source,
    targetId: vehicleId,
    step: 'interact',
    progressTicks: 0,
    durationTicks: EXIT_TICKS,
    reservations: [],
  };
  if (groupId) task.groupId = groupId;
  if (parentId) task.parentId = parentId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  if (!reserveExit(world, planned.tile, task.id)) {
    failTask(world, task, CommandRejection.NoExit);
    return { ok: false, reason: CommandRejection.NoExit };
  }
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  spawnInteract(world, task, 'exit', EXIT_TICKS);
  return { ok: true };
}

function boardTeam(world: World, teamId: string, vehicleId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const plans = world.team.memberIds.map((memberId) => ({
    memberId,
    ...planBoard(world, memberId, vehicleId),
  }));
  const ready = plans.filter((plan) => plan.ok);
  const problems = plans.filter((plan) => !plan.ok && plan.reason !== CommandRejection.AlreadyAboard);
  if (ready.length === 0) {
    if (problems.length === 0) return { ok: true };
    const first = problems[0];
    return { ok: false, reason: first && !first.ok ? first.reason : CommandRejection.NoVehicle };
  }
  const groupId = nextIdentifier(world, 'group');
  for (const plan of ready) cancelOpenRoots(world, plan.memberId);
  for (const plan of plans) {
    if (!plan.ok) {
      if (plan.reason === CommandRejection.AlreadyAboard) continue;
      failCrew(world, plan.memberId, vehicleId, groupId, plan.reason);
      continue;
    }
    boardVehicle(world, plan.memberId, vehicleId, 'team', groupId);
  }
  return { ok: true };
}

function disembarkTeam(world: World, teamId: string, vehicleId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle) return { ok: false, reason: CommandRejection.NoVehicle };
  if (vehicle.vehicle.status === 'moving')
    return { ok: false, reason: CommandRejection.VehicleMoving };
  const aboard = world.team.memberIds.filter((memberId) =>
    vehicle.vehicle?.occupants.includes(memberId),
  );
  if (aboard.length === 0) return { ok: false, reason: CommandRejection.NotAboard };
  const groupId = nextIdentifier(world, 'group');
  for (const memberId of aboard) exitVehicle(world, memberId, vehicleId, 'team', groupId);
  return { ok: true };
}

function driveVehicle(world: World, vehicleId: string, destinationNodeId: string): CommandResult {
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle || !vehicle.position)
    return { ok: false, reason: CommandRejection.NoVehicle };
  if (vehicle.vehicle.status === 'moving')
    return { ok: false, reason: CommandRejection.VehicleMoving };
  const route = routeTo(world, vehicle, destinationNodeId);
  if (!route.ok) return route;
  if (!vehicle.vehicle.occupants.includes(vehicle.vehicle.designatedDriverId)) {
    return { ok: false, reason: CommandRejection.NoDriver };
  }
  const task = createDrive(world, vehicle, destinationNodeId, route.path, 'individual');
  return task ? { ok: true } : { ok: false, reason: CommandRejection.ParkingReserved };
}

function respondTo(
  world: World,
  teamId: string,
  destinationNodeId: string,
  disembark: boolean,
): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const vehicleId = world.team.apparatusId;
  if (!vehicleId) return { ok: false, reason: CommandRejection.NoVehicle };
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle) return { ok: false, reason: CommandRejection.NoVehicle };
  if (vehicle.vehicle.status === 'moving')
    return { ok: false, reason: CommandRejection.VehicleMoving };
  const route = routeTo(world, vehicle, destinationNodeId);
  if (!route.ok) return route;

  const driverId = vehicle.vehicle.designatedDriverId;
  const driverAboard = vehicle.vehicle.occupants.includes(driverId);
  if (!driverAboard && busyIndividual(world, driverId)) {
    return { ok: false, reason: CommandRejection.NoDriver };
  }
  if (!driverAboard) {
    const driverPlan = planBoard(world, driverId, vehicleId);
    if (!driverPlan.ok) return driverPlan;
  }

  const groupId = nextIdentifier(world, 'group');
  const task: RespondTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'respond',
    state: 'pending',
    assigneeId: vehicleId,
    source: 'team',
    groupId,
    targetId: vehicleId,
    destinationNodeId,
    disembark,
    step: 'board',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);

  for (const memberId of world.team.memberIds) {
    if (vehicle.vehicle.occupants.includes(memberId)) continue;
    if (busyIndividual(world, memberId)) {
      failCrew(world, memberId, vehicleId, groupId, CommandRejection.Missing, task.id);
      continue;
    }
    const planned = planBoard(world, memberId, vehicleId);
    if (!planned.ok) {
      failCrew(world, memberId, vehicleId, groupId, planned.reason, task.id);
      continue;
    }
    cancelOpenRoots(world, memberId);
    boardVehicle(world, memberId, vehicleId, 'team', groupId, task.id);
  }
  return { ok: true };
}

function advanceBoard(world: World, task: BoardVehicleTask): void {
  const vehicle = world.entities.get(task.targetId);
  if (!vehicle?.vehicle) {
    failTask(world, task, CommandRejection.NoVehicle);
    return;
  }
  const responder = world.entities.get(task.assigneeId);
  if (responder?.responder?.aboardVehicleId === vehicle.id) {
    completeTask(world, task);
    return;
  }
  if (!reserveSeat(vehicle.vehicle, task.assigneeId, task.id)) {
    failTask(world, task, CommandRejection.Full);
    return;
  }
  refreshVehicleStatus(vehicle.vehicle);
  const child = childStatus(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (child === 'failed') {
    failTask(world, task, childReason(world, task));
    return;
  }
  if (child === 'done') {
    if (task.step === 'move-to') {
      spawnInteract(world, task, 'board', BOARD_TICKS);
      return;
    }
    commitBoard(world, responder, vehicle);
    completeTask(world, task);
    return;
  }
  if (task.step === 'interact') {
    spawnInteract(world, task, 'board', BOARD_TICKS, task.progressTicks);
    return;
  }
  if (task.approachTile) spawnMove(world, task, task.approachTile);
}

function advanceExit(world: World, task: ExitVehicleTask): void {
  const vehicle = world.entities.get(task.targetId);
  const responder = world.entities.get(task.assigneeId);
  if (!vehicle?.vehicle || !responder?.responder) {
    failTask(world, task, CommandRejection.NoVehicle);
    return;
  }
  if (vehicle.vehicle.status === 'moving') {
    failTask(world, task, CommandRejection.VehicleMoving);
    return;
  }
  const child = childStatus(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (child === 'failed') {
    failTask(world, task, childReason(world, task));
    return;
  }
  if (child === 'done' || task.step === 'interact') {
    const tile = reservedTile(world, task.id);
    if (!tile) {
      failTask(world, task, CommandRejection.NoExit);
      return;
    }
    responder.position = tileCenter(tile);
    responder.responder.aboardVehicleId = undefined;
    vehicle.vehicle.occupants = vehicle.vehicle.occupants.filter((id) => id !== responder.id);
    if (vehicle.vehicle.driverId === responder.id) vehicle.vehicle.driverId = null;
    clearRoute(responder);
    releaseTransport(world, task.id);
    refreshVehicleStatus(vehicle.vehicle);
    completeTask(world, task);
  }
}

function advanceRespond(world: World, task: RespondTask): void {
  const vehicle = world.entities.get(task.targetId);
  if (!vehicle?.vehicle) {
    failTask(world, task, CommandRejection.NoVehicle);
    return;
  }
  if (task.step === 'board') {
    if (crewBusy(world, task.id, 'board-vehicle')) return;
    if (!vehicle.vehicle.occupants.includes(vehicle.vehicle.designatedDriverId)) {
      failTask(world, task, CommandRejection.NoDriver);
      return;
    }
    dropSuspended(world, task.id, 'board-vehicle');
    const route = routeTo(world, vehicle, task.destinationNodeId);
    if (!route.ok) {
      failTask(world, task, route.reason);
      return;
    }
    const drive = createDrive(world, vehicle, task.destinationNodeId, route.path, 'team', task);
    if (!drive) failTask(world, task, CommandRejection.ParkingReserved);
    return;
  }
  if (task.step === 'drive') {
    const drive = task.childTaskId ? world.tasks.get(task.childTaskId) : undefined;
    if (!drive || drive.state === 'running' || drive.state === 'ready' || drive.state === 'pending')
      return;
    if (drive.state === 'failed') {
      failTask(world, task, drive.failureReason ?? CommandRejection.Unreachable);
      return;
    }
    if (drive.state !== 'completed') return;
    if (!task.disembark) {
      completeTask(world, task);
      return;
    }
    task.step = 'disembark';
    const groupId = task.groupId;
    for (const occupantId of [...vehicle.vehicle.occupants]) {
      exitVehicle(world, occupantId, vehicle.id, 'team', groupId, task.id);
    }
    if (!crewBusy(world, task.id, 'exit-vehicle') && vehicle.vehicle.occupants.length === 0) {
      completeTask(world, task);
    }
    return;
  }
  if (crewBusy(world, task.id, 'exit-vehicle')) return;
  const failed = [...world.tasks.values()].some(
    (child) =>
      child.parentId === task.id && child.kind === 'exit-vehicle' && child.state === 'failed',
  );
  if (failed) failTask(world, task, CommandRejection.NoExit);
  else completeTask(world, task);
}

function commitBoard(world: World, responder: Entity | undefined, vehicle: Entity): void {
  if (!responder?.responder || !vehicle.vehicle) return;
  responder.responder.aboardVehicleId = vehicle.id;
  if (!vehicle.vehicle.occupants.includes(responder.id))
    vehicle.vehicle.occupants.push(responder.id);
  if (responder.id === vehicle.vehicle.designatedDriverId) vehicle.vehicle.driverId = responder.id;
  clearRoute(responder);
  for (const task of world.tasks.values()) {
    if (task.assigneeId === responder.id && task.kind === 'board-vehicle') {
      releaseTransport(world, task.id);
    }
  }
  refreshVehicleStatus(vehicle.vehicle);
}

function createDrive(
  world: World,
  vehicle: Entity,
  destinationNodeId: string,
  path: string[],
  source: 'team' | 'individual',
  parent?: RespondTask,
): DriveVehicleTask | null {
  if (!vehicle.vehicle) return null;
  if (!reserveNode(world, destinationNodeId, 'pending')) return null;
  const task: DriveVehicleTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'drive-vehicle',
    state: 'pending',
    assigneeId: vehicle.id,
    source,
    targetId: vehicle.id,
    destinationNodeId,
    nodeIds: [...path],
    pathIndex: 0,
    step: 'drive',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (parent) {
    task.parentId = parent.id;
    task.groupId = parent.groupId;
    task.source = 'team';
  }
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  world.reservedNodes.set(destinationNodeId, task.id);
  vehicle.vehicle.status = 'moving';
  vehicle.vehicle.destinationNodeId = destinationNodeId;
  if (parent) {
    parent.childTaskId = task.id;
    parent.step = 'drive';
  }
  return task;
}

function planBoard(
  world: World,
  responderId: string,
  vehicleId: string,
): { ok: true; approach: Tile } | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position)
    return { ok: false, reason: CommandRejection.UnknownResponder };
  if (entity.responder.aboardVehicleId === vehicleId) {
    return { ok: false, reason: CommandRejection.AlreadyAboard };
  }
  if (entity.responder.aboardVehicleId) return { ok: false, reason: CommandRejection.Aboard };
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle || !vehicle.position)
    return { ok: false, reason: CommandRejection.NoVehicle };
  if (vehicle.vehicle.status === 'moving')
    return { ok: false, reason: CommandRejection.VehicleMoving };
  const held = vehicle.vehicle.seatReservations.some((seat) => seat.responderId === responderId);
  const aboard = vehicle.vehicle.occupants.includes(responderId);
  if (
    !held &&
    !aboard &&
    vehicle.vehicle.occupants.length + vehicle.vehicle.seatReservations.length >=
      vehicle.vehicle.capacity
  ) {
    return { ok: false, reason: CommandRejection.Full };
  }
  const approach = nearestApproach(
    world,
    tileOf(entity.position),
    tilesAround(world, tileOf(vehicle.position)),
  );
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  return { ok: true, approach };
}

function planExit(
  world: World,
  responderId: string,
  vehicleId: string,
): { ok: true; tile: Tile } | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder) return { ok: false, reason: CommandRejection.UnknownResponder };
  if (entity.responder.aboardVehicleId !== vehicleId)
    return { ok: false, reason: CommandRejection.NotAboard };
  const vehicle = world.entities.get(vehicleId);
  if (!vehicle?.vehicle || !vehicle.position)
    return { ok: false, reason: CommandRejection.NoVehicle };
  if (vehicle.vehicle.status === 'moving')
    return { ok: false, reason: CommandRejection.VehicleMoving };
  const origin = tileOf(vehicle.position);
  const tile = tilesAround(world, origin).find((candidate) => {
    if (candidate.x === origin.x && candidate.y === origin.y) return false;
    return !world.reservedExits.has(tileKey(candidate));
  });
  if (!tile) return { ok: false, reason: CommandRejection.NoExit };
  return { ok: true, tile };
}

function routeTo(
  world: World,
  vehicle: Entity,
  destinationNodeId: string,
): { ok: true; path: string[] } | { ok: false; reason: string } {
  if (!vehicle.vehicle) return { ok: false, reason: CommandRejection.NoVehicle };
  if (!world.roadNodes.has(destinationNodeId))
    return { ok: false, reason: CommandRejection.UnknownNode };
  const reserved = world.reservedNodes.get(destinationNodeId);
  if (reserved) return { ok: false, reason: CommandRejection.ParkingReserved };
  const path = findRoadPath(
    world.roadNodes,
    world.adjacency,
    vehicle.vehicle.nodeId,
    destinationNodeId,
  );
  if (!path) return { ok: false, reason: CommandRejection.Unreachable };
  return { ok: true, path };
}

function failCrew(
  world: World,
  assigneeId: string,
  vehicleId: string,
  groupId: string,
  reason: string,
  parentId?: string,
): void {
  const task: BoardVehicleTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'board-vehicle',
    state: 'pending',
    assigneeId,
    source: 'team',
    groupId,
    targetId: vehicleId,
    step: 'move-to',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (parentId) task.parentId = parentId;
  transition(task, 'failed');
  task.failureReason = reason;
  world.tasks.set(task.id, task);
}

function cancelOpenRoots(world: World, assigneeId: string): void {
  for (const task of [...world.tasks.values()]) {
    if (task.assigneeId === assigneeId && !task.parentId && isOpen(task.state))
      cancelTask(world, task);
  }
}

function openCrewTask(world: World, assigneeId: string, kind: Task['kind']): boolean {
  return [...world.tasks.values()].some(
    (task) => task.assigneeId === assigneeId && task.kind === kind && isOpen(task.state),
  );
}

function busyIndividual(world: World, assigneeId: string): boolean {
  return [...world.tasks.values()].some(
    (task) =>
      task.assigneeId === assigneeId &&
      !task.parentId &&
      task.source === 'individual' &&
      isOpen(task.state),
  );
}

function crewBusy(world: World, parentId: string, kind: 'board-vehicle' | 'exit-vehicle'): boolean {
  return [...world.tasks.values()].some(
    (task) =>
      task.parentId === parentId &&
      task.kind === kind &&
      (task.state === 'pending' || task.state === 'ready' || task.state === 'running'),
  );
}

function dropSuspended(
  world: World,
  parentId: string,
  kind: 'board-vehicle' | 'exit-vehicle',
): void {
  for (const task of [...world.tasks.values()]) {
    if (task.parentId !== parentId || task.kind !== kind || task.state !== 'suspended') continue;
    releaseTransport(world, task.id);
    transition(task, 'cancelled');
    task.failureReason = CommandRejection.Missing;
    task.suspendedByTaskId = undefined;
  }
}

function childStatus(world: World, task: Task): 'none' | 'wait' | 'done' | 'failed' | 'suspended' {
  if (!('childTaskId' in task) || !task.childTaskId) return 'none';
  const child = world.tasks.get(task.childTaskId);
  if (!child || child.state === 'cancelled') return 'none';
  if (child.state === 'failed') return 'failed';
  if (child.state === 'completed') return 'done';
  if (child.state === 'suspended') return 'suspended';
  return 'wait';
}

function childReason(world: World, task: Task): string {
  if (!('childTaskId' in task) || !task.childTaskId) return CommandRejection.NoPath;
  return world.tasks.get(task.childTaskId)?.failureReason ?? CommandRejection.NoPath;
}

function reservedTile(world: World, taskId: string): Tile | null {
  for (const [key, reservedBy] of world.reservedExits) {
    if (reservedBy !== taskId) continue;
    const [xText, yText] = key.split(',');
    return { x: Number(xText), y: Number(yText) };
  }
  return null;
}
