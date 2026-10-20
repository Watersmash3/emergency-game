import type { Scenario, Tile } from '@emergency/protocol';

import {
  doorPassable,
  type BuildingRecord,
  type DoorLink,
  type FloorRecord,
  type RoomRecord,
} from '../components/building.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { tileKey, tileOf } from '../navigation/grid.ts';
import {
  FORCE_CAPABILITY,
  abandonTask,
  carriesCapability,
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
import { noteBuildingBlocked, noteHazard, noteRoomSearched } from './notices.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type {
  CloseDoorTask,
  OpenDoorTask,
  OverhaulTask,
  SearchBuildingTask,
  SearchRoomTask,
  VentilateTask,
} from './types.ts';
import { blocksPedestrian } from './vehicleRules.ts';

export const DOOR_TICKS = 16;
export const SEARCH_TICKS = 8;
export const OVERHAUL_TICKS = 24;

export function applyBuildingCommand(
  world: World,
  command:
    | { type: 'open-door'; responderId: string; doorId: string }
    | { type: 'close-door'; responderId: string; doorId: string }
    | { type: 'enter-building'; responderId: string; buildingId: string }
    | { type: 'search-room'; responderId: string; roomId: string }
    | { type: 'search-building'; teamId: string; buildingId: string }
    | { type: 'ventilate'; responderId: string; openingId: string }
    | { type: 'overhaul-room'; responderId: string; roomId: string },
): CommandResult {
  switch (command.type) {
    case 'open-door':
      return openDoor(world, command.responderId, command.doorId);
    case 'close-door':
      return closeDoor(world, command.responderId, command.doorId);
    case 'enter-building':
      return enterBuilding(world, command.responderId, command.buildingId);
    case 'search-room':
      return searchRoom(world, command.responderId, command.roomId, 'individual');
    case 'search-building':
      return searchBuilding(world, command.teamId, command.buildingId);
    case 'ventilate':
      return ventilate(world, command.responderId, command.openingId);
    case 'overhaul-room':
      return overhaulRoom(world, command.responderId, command.roomId);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export function advanceBuildingTask(
  world: World,
  task: OpenDoorTask | CloseDoorTask | SearchRoomTask | SearchBuildingTask | VentilateTask | OverhaulTask,
): void {
  if (task.kind === 'search-building') {
    advanceSearchBuilding(world, task);
    return;
  }
  if (task.kind === 'search-room') {
    advanceSearchRoom(world, task);
    return;
  }
  if (task.kind === 'ventilate') {
    advanceVentilate(world, task);
    return;
  }
  if (task.kind === 'overhaul') {
    advanceOverhaul(world, task);
    return;
  }
  advanceDoorTask(world, task);
}

export function revealRooms(world: World): void {
  for (const entity of world.entities.values()) {
    if (!entity.position || !entity.responder || entity.responder.aboardVehicleId) continue;
    const room = roomAt(world, tileOf(entity.position));
    if (room) room.discovered = true;
  }
}

export function setDoorState(
  world: World,
  door: Entity,
  state: 'open' | 'closed' | 'locked' | 'forced',
): void {
  if (!door.interactable || !door.position) return;
  door.interactable.state = state;
  const key = tileKey(tileOf(door.position));
  if (doorPassable(state)) world.blocked.delete(key);
  else world.blocked.add(key);
  world.routeEpoch += 1;
}

export function roomAt(world: World, tile: Tile): RoomRecord | undefined {
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) return room;
  }
  return undefined;
}

export function releaseStructure(world: World, task: { id: string; kind: string; targetId?: string; state: string }): void {
  if (task.targetId && world.reservedDoors.get(task.targetId) === task.id) {
    world.reservedDoors.delete(task.targetId);
  }
  for (const room of world.rooms.values()) {
    if (room.reservedByTaskId !== task.id) continue;
    room.reservedByTaskId = null;
    room.assigneeId = null;
    if (room.state === 'searching' && task.state !== 'completed') room.state = 'unsearched';
  }
}

function openDoor(world: World, responderId: string, doorId: string): CommandResult {
  const approach = prepareDoor(world, responderId, doorId, 'closed');
  if (!approach.ok) return approach;
  const task = doorTask(world, 'open-door', responderId, doorId, approach.tile) as OpenDoorTask;
  reserveDoor(world, doorId, task.id);
  overrideWith(world, responderId, task.id);
  spawnMove(world, task, approach.tile);
  return { ok: true };
}

function closeDoor(world: World, responderId: string, doorId: string): CommandResult {
  const approach = prepareDoor(world, responderId, doorId, 'open');
  if (!approach.ok) return approach;
  const door = world.entities.get(doorId);
  if (door?.position && occupied(world, tileOf(door.position))) {
    return { ok: false, reason: CommandRejection.DoorOccupied };
  }
  const task = doorTask(world, 'close-door', responderId, doorId, approach.tile) as CloseDoorTask;
  reserveDoor(world, doorId, task.id);
  overrideWith(world, responderId, task.id);
  spawnMove(world, task, approach.tile);
  return { ok: true };
}

function enterBuilding(world: World, responderId: string, buildingId: string): CommandResult {
  const entity = responder(world, responderId);
  if (!entity.ok) return entity;
  const floor = [...world.floors.values()].find((candidate) => candidate.buildingId === buildingId);
  if (!floor) return { ok: false, reason: CommandRejection.UnknownBuilding };
  const door = world.entities.get(floor.entranceDoorId);
  if (door?.interactable && !doorPassable(door.interactable.state)) {
    return { ok: false, reason: CommandRejection.DoorClosed };
  }
  if (!findPath(world, tileOf(entity.entity.position!), floor.entry)) {
    return { ok: false, reason: CommandRejection.NoPath };
  }
  return moveInside(world, responderId, floor.entry);
}

function searchRoom(
  world: World,
  responderId: string,
  roomId: string,
  source: 'individual' | 'team',
  parentId?: string,
): CommandResult {
  const entity = responder(world, responderId);
  if (!entity.ok) return entity;
  const room = world.rooms.get(roomId);
  if (!room) return { ok: false, reason: CommandRejection.UnknownRoom };
  if (room.state === 'searched') return { ok: false, reason: CommandRejection.RoomSearched };
  if (room.reservedByTaskId) {
    const holder = world.tasks.get(room.reservedByTaskId);
    if (holder && holder.assigneeId !== responderId && isOpen(holder.state)) {
      return { ok: false, reason: CommandRejection.RoomReserved };
    }
  }
  const destination = room.searchTiles[0] ?? room.entrance;
  if (!findPath(world, tileOf(entity.entity.position!), destination)) {
    return { ok: false, reason: CommandRejection.NoPath };
  }
  const task: SearchRoomTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'search-room',
    state: 'pending',
    assigneeId: responderId,
    source,
    targetId: roomId,
    step: 'move-to',
    searchIndex: 0,
    progressTicks: 0,
    durationTicks: SEARCH_TICKS,
    reservations: [],
    ...(parentId ? { parentId } : {}),
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  room.state = 'searching';
  room.assigneeId = responderId;
  room.reservedByTaskId = task.id;
  if (source === 'individual') overrideWith(world, responderId, task.id);
  spawnMove(world, task, destination);
  return { ok: true };
}

type ForceDoorFn = (world: World, responderId: string, doorId: string) => CommandResult;

let forceDoorForSearch: ForceDoorFn | null = null;

/** Registered by the interaction tasks so a search can force a locked door without an import cycle. */
export function registerForceDoor(forceDoor: ForceDoorFn): void {
  forceDoorForSearch = forceDoor;
}

function searchBuilding(world: World, teamId: string, buildingId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  if (!world.buildings.has(buildingId)) return { ok: false, reason: CommandRejection.UnknownBuilding };
  for (const room of roomsOf(world, buildingId)) {
    if (room.state !== 'blocked') continue;
    room.state = 'unsearched';
    room.assigneeId = null;
    room.reservedByTaskId = null;
  }
  const task: SearchBuildingTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'search-building',
    state: 'pending',
    assigneeId: buildingId,
    source: 'team',
    targetId: buildingId,
    step: 'plan',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  advanceSearchBuilding(world, task);
  return { ok: true };
}

function advanceDoorTask(world: World, task: OpenDoorTask | CloseDoorTask): void {
  const door = world.entities.get(task.targetId);
  if (door?.interactable?.objectType !== 'door') {
    failTask(world, task, CommandRejection.UnknownObject);
    return;
  }
  const expected = task.kind === 'open-door' ? 'closed' : 'open';
  if (door.interactable.state !== expected) {
    failTask(world, task, task.kind === 'open-door' ? CommandRejection.DoorOpen : CommandRejection.DoorClosed);
    return;
  }
  const child = childStatus(world, task.childTaskId);
  if (child === 'wait') return;
  if (child === 'failed') {
    failTask(world, task, CommandRejection.Cancelled);
    return;
  }
  if (child === 'done') {
    if (task.step === 'move-to') {
      spawnInteract(world, task, 'operate', DOOR_TICKS);
      return;
    }
    if (task.kind === 'close-door' && door.position && occupied(world, tileOf(door.position))) {
      failTask(world, task, CommandRejection.DoorOccupied);
      return;
    }
    setDoorState(world, door, task.kind === 'open-door' ? 'open' : 'closed');
    completeTask(world, task);
    return;
  }
  if (task.approachTile) spawnMove(world, task, task.approachTile);
}

function advanceSearchRoom(world: World, task: SearchRoomTask): void {
  const room = world.rooms.get(task.targetId);
  const entity = world.entities.get(task.assigneeId);
  if (!room || !entity?.position) {
    failTask(world, task, CommandRejection.UnknownRoom);
    return;
  }
  const child = childStatus(world, task.childTaskId);
  if (child === 'wait') return;
  if (child === 'failed') {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  const tile = room.searchTiles[task.searchIndex];
  if (!tile) {
    finishSearch(world, task, room);
    return;
  }
  if (task.step === 'search') {
    const standing = tileOf(entity.position);
    if (standing.x !== tile.x || standing.y !== tile.y) {
      task.step = 'move-to';
      spawnMove(world, task, tile);
      return;
    }
    task.progressTicks += 1;
    task.durationTicks = SEARCH_TICKS;
    if (task.progressTicks >= SEARCH_TICKS) {
      task.searchIndex += 1;
      task.progressTicks = 0;
      task.step = 'move-to';
      task.childTaskId = undefined;
      if (task.searchIndex >= room.searchTiles.length) finishSearch(world, task, room);
      else spawnMove(world, task, room.searchTiles[task.searchIndex]!);
    }
    return;
  }
  if (child === 'done') {
    task.step = 'search';
    task.progressTicks = 0;
    task.childTaskId = undefined;
    return;
  }
  spawnMove(world, task, tile);
}

function advanceSearchBuilding(world: World, task: SearchBuildingTask): void {
  const rooms = roomsOf(world, task.targetId);
  for (const child of [...world.tasks.values()]) {
    if (child.parentId !== task.id || child.kind !== 'search-room') continue;
    if (child.state !== 'suspended' && child.state !== 'failed' && child.state !== 'cancelled') continue;
    if (child.state === 'suspended') abandonTask(world, child);
    const room = world.rooms.get(child.targetId);
    if (room?.reservedByTaskId === child.id) {
      room.reservedByTaskId = null;
      room.assigneeId = null;
      if (room.state === 'searching') room.state = 'unsearched';
    }
  }

  const free = world.team.memberIds.filter((memberId) => memberAvailable(world, memberId));
  const pending = rooms
    .filter((room) => room.state === 'unsearched' && !room.reservedByTaskId)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  const claimed = new Set<string>();
  for (const room of pending) {
    const candidates = free
      .filter((memberId) => !claimed.has(memberId) && canReach(world, memberId, room.entrance))
      .sort((left, right) => left.localeCompare(right));
    const memberId = candidates[0];
    if (!memberId) continue;
    const started = searchRoom(world, memberId, room.id, 'team', task.id);
    if (started.ok) claimed.add(memberId);
  }

  const stillOpen = rooms.filter((room) => room.state !== 'searched');
  if (stillOpen.length === 0) {
    completeTask(world, task);
    return;
  }
  const searching = rooms.some((room) => room.state === 'searching');
  const reachable = rooms.some(
    (room) => room.state === 'unsearched' && free.some((memberId) => canReach(world, memberId, room.entrance)),
  );
  const breaching = doorWorkInProgress(world, task.targetId);
  if (!reachable && !breaching && free.length > 0) startBreach(world, task.targetId, free);
  if (!searching && !reachable && !doorWorkInProgress(world, task.targetId)) {
    for (const room of rooms) {
      if (room.state === 'unsearched') room.state = 'blocked';
    }
    noteBuildingBlocked(world, task.targetId);
    completeTask(world, task);
  }
}

function finishSearch(world: World, task: SearchRoomTask, room: RoomRecord): void {
  room.state = 'searched';
  room.discovered = true;
  room.reservedByTaskId = null;
  room.assigneeId = null;
  for (const discovery of room.discoveries) discovery.found = true;
  const names = room.discoveries.map((discovery) => discovery.name);
  noteRoomSearched(world, task.assigneeId, room.name, names);
  completeTask(world, task);
}

function ventilate(world: World, responderId: string, openingId: string): CommandResult {
  const opening = world.entities.get(openingId);
  const kind = opening?.interactable?.objectType;
  if (kind === 'door') {
    if (opening?.interactable?.state === 'locked') return { ok: false, reason: CommandRejection.DoorClosed };
    if (opening?.interactable?.state === 'forced' || opening?.interactable?.state === 'open') {
      return { ok: false, reason: CommandRejection.OpeningOpen };
    }
    return openDoor(world, responderId, openingId);
  }
  if (kind !== 'window' || !opening?.interactable || !opening.position) {
    return { ok: false, reason: CommandRejection.UnknownOpening };
  }
  if (opening.interactable.state === 'open') return { ok: false, reason: CommandRejection.OpeningOpen };
  const person = responder(world, responderId);
  if (!person.ok) return person;
  const tile = nearestApproach(world, tileOf(person.entity.position!), opening.interactable.interactionTiles);
  if (!tile) return { ok: false, reason: CommandRejection.NoPath };
  const task: VentilateTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'ventilate',
    state: 'pending',
    assigneeId: responderId,
    source: 'individual',
    targetId: openingId,
    step: 'move-to',
    approachTile: { ...tile },
    progressTicks: 0,
    durationTicks: DOOR_TICKS,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  reserveDoor(world, openingId, task.id);
  overrideWith(world, responderId, task.id);
  spawnMove(world, task, tile);
  return { ok: true };
}

function overhaulRoom(world: World, responderId: string, roomId: string): CommandResult {
  const person = responder(world, responderId);
  if (!person.ok) return person;
  const room = world.rooms.get(roomId);
  if (!room) return { ok: false, reason: CommandRejection.UnknownRoom };
  const hot = room.tiles.some((tile) => {
    const cell = world.hazards.get(`${tile.x},${tile.y}`);
    return Boolean(cell && (cell.hotspot || cell.temperature > 70 || cell.combustion > 0.05 || cell.smoke > 0.2));
  });
  if (!hot && !room.flashed) return { ok: false, reason: CommandRejection.NothingToOverhaul };
  if (!findPath(world, tileOf(person.entity.position!), room.entrance)) {
    return { ok: false, reason: CommandRejection.NoPath };
  }
  const task: OverhaulTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'overhaul',
    state: 'pending',
    assigneeId: responderId,
    source: 'individual',
    targetId: roomId,
    step: 'move-to',
    progressTicks: 0,
    durationTicks: OVERHAUL_TICKS,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  room.reservedByTaskId = task.id;
  overrideWith(world, responderId, task.id);
  spawnMove(world, task, room.entrance);
  return { ok: true };
}

function advanceVentilate(world: World, task: VentilateTask): void {
  const opening = world.entities.get(task.targetId);
  if (opening?.interactable?.objectType !== 'window') {
    failTask(world, task, CommandRejection.UnknownOpening);
    return;
  }
  if (opening.interactable.state === 'open') {
    completeTask(world, task);
    return;
  }
  const child = childStatus(world, task.childTaskId);
  if (child === 'wait') return;
  if (child === 'failed') {
    failTask(world, task, CommandRejection.Cancelled);
    return;
  }
  if (child === 'done' && task.step === 'move-to') {
    spawnInteract(world, task, 'operate', DOOR_TICKS);
    return;
  }
  if (child === 'done') {
    opening.interactable.state = 'open';
    completeTask(world, task);
    return;
  }
  if (task.approachTile) spawnMove(world, task, task.approachTile);
}

function advanceOverhaul(world: World, task: OverhaulTask): void {
  const room = world.rooms.get(task.targetId);
  const entity = world.entities.get(task.assigneeId);
  if (!room || !entity?.position) {
    failTask(world, task, CommandRejection.UnknownRoom);
    return;
  }
  const child = childStatus(world, task.childTaskId);
  if (child === 'wait') return;
  if (child === 'failed') {
    failTask(world, task, CommandRejection.Cancelled);
    return;
  }
  if (task.step === 'move-to') {
    if (child !== 'done') {
      spawnMove(world, task, room.entrance);
      return;
    }
    task.step = 'overhaul';
    task.progressTicks = 0;
  }
  task.progressTicks += 1;
  if (task.progressTicks < task.durationTicks) return;
  for (const tile of room.tiles) {
    const cell = world.hazards.get(`${tile.x},${tile.y}`);
    if (!cell) continue;
    cell.revealed = cell.hotspot || cell.temperature > 70 || cell.revealed;
    cell.temperature = Math.max(20, Math.min(cell.temperature, 36));
    cell.combustion = 0;
    cell.water = Math.max(cell.water, 0.55);
    cell.steam = Math.min(1, cell.steam + (cell.revealed ? 0.35 : 0));
    cell.hotspot = false;
  }
  room.overhauled = true;
  room.reservedByTaskId = null;
  noteHazard(world, `overhaul:${room.id}`, `${room.name} overhauled.`);
  completeTask(world, task);
}

function doorTask(
  world: World,
  kind: 'open-door' | 'close-door',
  responderId: string,
  doorId: string,
  tile: Tile,
): OpenDoorTask | CloseDoorTask {
  const task = {
    id: nextIdentifier(world, 'task'),
    kind,
    state: 'pending' as const,
    assigneeId: responderId,
    source: 'individual' as const,
    targetId: doorId,
    step: 'move-to',
    approachTile: { ...tile },
    progressTicks: 0,
    durationTicks: DOOR_TICKS,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  return task as OpenDoorTask | CloseDoorTask;
}

function prepareDoor(
  world: World,
  responderId: string,
  doorId: string,
  expected: 'open' | 'closed',
): { ok: true; tile: Tile } | { ok: false; reason: string } {
  const entity = responder(world, responderId);
  if (!entity.ok) return entity;
  const door = world.entities.get(doorId);
  if (door?.interactable?.objectType !== 'door') return { ok: false, reason: CommandRejection.UnknownObject };
  if (door.interactable.state === 'forced') return { ok: false, reason: CommandRejection.DoorDamaged };
  if (door.interactable.state === 'locked') return { ok: false, reason: CommandRejection.DoorClosed };
  if (door.interactable.state !== expected) {
    return {
      ok: false,
      reason: expected === 'closed' ? CommandRejection.DoorOpen : CommandRejection.DoorClosed,
    };
  }
  const reserved = world.reservedDoors.get(doorId);
  if (reserved && reserved !== '') return { ok: false, reason: CommandRejection.Reserved };
  const tile = nearestApproach(world, tileOf(entity.entity.position!), door.interactable.interactionTiles);
  if (!tile) return { ok: false, reason: CommandRejection.NoPath };
  return { ok: true, tile };
}

function reserveDoor(world: World, doorId: string, taskId: string): void {
  world.reservedDoors.set(doorId, taskId);
}

function responder(
  world: World,
  responderId: string,
): { ok: true; entity: Entity } | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) return { ok: false, reason: CommandRejection.UnknownResponder };
  const aboard = blocksPedestrian(entity);
  if (aboard) return { ok: false, reason: aboard };
  return { ok: true, entity };
}

function occupied(world: World, tile: Tile): boolean {
  for (const entity of world.entities.values()) {
    if (!entity.position || !entity.responder || entity.responder.aboardVehicleId) continue;
    const at = tileOf(entity.position);
    if (at.x === tile.x && at.y === tile.y) return true;
  }
  return false;
}

function childStatus(world: World, childId: string | undefined): 'wait' | 'absent' | 'done' | 'failed' {
  if (!childId) return 'absent';
  const child = world.tasks.get(childId);
  if (!child) return 'absent';
  if (child.state === 'completed') return 'done';
  if (child.state === 'failed' || child.state === 'cancelled') return 'failed';
  if (isOpen(child.state)) return 'wait';
  return 'absent';
}

function memberAvailable(world: World, memberId: string): boolean {
  const entity = world.entities.get(memberId);
  if (!entity?.position || entity.responder?.aboardVehicleId) return false;
  for (const task of world.tasks.values()) {
    if (task.assigneeId === memberId && isOpen(task.state) && task.state !== 'suspended') return false;
  }
  return true;
}

function canReach(world: World, memberId: string, tile: Tile): boolean {
  const entity = world.entities.get(memberId);
  if (!entity?.position) return false;
  return findPath(world, tileOf(entity.position), tile) !== null;
}

function buildingDoors(world: World, buildingId: string): Entity[] {
  const floor = [...world.floors.values()].find((candidate) => candidate.buildingId === buildingId);
  const rooms = roomsOf(world, buildingId);
  const doors: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (entity.interactable?.objectType !== 'door' || !entity.position) continue;
    const tile = tileOf(entity.position);
    const entrance = entity.id === floor?.entranceDoorId;
    const touches = rooms.some((room) =>
      room.tiles.some((roomTile) => Math.abs(roomTile.x - tile.x) + Math.abs(roomTile.y - tile.y) === 1),
    );
    if (entrance || touches) doors.push(entity);
  }
  doors.sort((left, right) => Number(right.id === floor?.entranceDoorId) - Number(left.id === floor?.entranceDoorId));
  return doors;
}

function doorWorkInProgress(world: World, buildingId: string): boolean {
  const ids = new Set(buildingDoors(world, buildingId).map((door) => door.id));
  return [...world.tasks.values()].some(
    (task) =>
      (task.kind === 'force-door' || task.kind === 'open-door') &&
      isOpen(task.state) &&
      ids.has(task.targetId),
  );
}

function startBreach(world: World, buildingId: string, free: string[]): boolean {
  const doors = buildingDoors(world, buildingId).filter((door) => {
    const state = door.interactable?.state;
    return state === 'locked' || state === 'closed';
  });
  for (const door of doors) {
    const state = door.interactable?.state;
    const members = [...free].sort((left, right) => {
      const leftTool = state === 'locked' && carriesCapability(world, left, FORCE_CAPABILITY) ? 0 : 1;
      const rightTool = state === 'locked' && carriesCapability(world, right, FORCE_CAPABILITY) ? 0 : 1;
      return leftTool - rightTool || left.localeCompare(right);
    });
    for (const memberId of members) {
      const result =
        state === 'locked'
          ? forceDoorForSearch?.(world, memberId, door.id)
          : openDoor(world, memberId, door.id);
      if (result?.ok) return true;
    }
  }
  return false;
}

function roomsOf(world: World, buildingId: string): RoomRecord[] {
  return [...world.rooms.values()]
    .filter((room) => room.buildingId === buildingId)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
}

function moveInside(world: World, responderId: string, destination: Tile): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.position) return { ok: false, reason: CommandRejection.UnknownResponder };
  const task = {
    id: nextIdentifier(world, 'task'),
    kind: 'move' as const,
    state: 'pending' as const,
    assigneeId: responderId,
    source: 'individual' as const,
    destination: { ...destination },
    reservations: [] as string[],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  overrideWith(world, responderId, task.id);
  clearRoute(entity);
  return { ok: true };
}

export function loadBuildings(scenario: Scenario): {
  buildings: Map<string, BuildingRecord>;
  floors: Map<string, FloorRecord>;
  rooms: Map<string, RoomRecord>;
  doorLinks: Map<string, DoorLink>;
  walls: Tile[];
} {
  const buildings = new Map<string, BuildingRecord>();
  const floors = new Map<string, FloorRecord>();
  const rooms = new Map<string, RoomRecord>();
  const doorLinks = new Map<string, DoorLink>();
  const walls: Tile[] = [];
  const seen = new Set<string>();

  for (const building of scenario.buildings) {
    if (seen.has(building.id) || seen.has(building.floor.id)) {
      throw new Error(`Duplicate building id ${building.id}`);
    }
    seen.add(building.id);
    seen.add(building.floor.id);
    const door = scenario.objects.find((object) => object.id === building.floor.entranceDoorId);
    if (door?.objectType !== 'door') {
      throw new Error(`Building ${building.id} has an unknown entrance`);
    }
    const floor = {
      id: building.floor.id,
      buildingId: building.id,
      name: building.floor.name,
      entranceDoorId: building.floor.entranceDoorId,
      entry: { ...building.floor.entry },
      walls: building.floor.walls.map((tile) => ({ ...tile })),
    };
    floors.set(floor.id, floor);
    buildings.set(building.id, { id: building.id, name: building.name, floorId: floor.id });
    doorLinks.set(door.id, {
      doorId: door.id,
      buildingId: building.id,
      roomIds: [],
      outside: true,
    });
    for (const wall of floor.walls) {
      if (wall.x < 0 || wall.y < 0 || wall.x >= scenario.width || wall.y >= scenario.height) {
        throw new Error(`Wall ${wall.x},${wall.y} is outside the map`);
      }
      walls.push(wall);
    }
    let entryFound = false;
    for (const room of building.floor.rooms) {
      if (seen.has(room.id)) throw new Error(`Duplicate room id ${room.id}`);
      seen.add(room.id);
      const contains = (tile: Tile) => room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y);
      if (!contains(room.entrance)) throw new Error(`Room ${room.id} entrance is outside the room`);
      if (room.searchTiles.some((tile) => !contains(tile))) {
        throw new Error(`Room ${room.id} searches outside its tiles`);
      }
      if (contains(floor.entry)) entryFound = true;
      const record: RoomRecord = {
        id: room.id,
        buildingId: building.id,
        floorId: floor.id,
        name: room.name,
        tiles: room.tiles.map((tile) => ({ ...tile })),
        entrance: { ...room.entrance },
        searchTiles: room.searchTiles.map((tile) => ({ ...tile })),
        state: 'unsearched',
        discovered: false,
        assigneeId: null,
        reservedByTaskId: null,
        discoveries: room.discoveries.map((discovery) => ({
          id: discovery.id,
          name: discovery.name,
          position: { ...discovery.position },
          found: false,
        })),
        upperTemp: 20,
        lowerTemp: 20,
        smoke: 0,
        oxygen: 1,
        overhauled: false,
        flashed: false,
      };
      rooms.set(record.id, record);
      const link = doorLinks.get(door.id);
      link?.roomIds.push(record.id);
    }
    if (!entryFound) throw new Error(`Building ${building.id} entry is not inside a room`);
  }

  return { buildings, floors, rooms, doorLinks, walls };
}
