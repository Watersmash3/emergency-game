import type { TaskState, Tile } from '@emergency/protocol';

import type { EquipmentInstance } from '../components/equipment.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { isWalkable, tileOf } from '../navigation/grid.ts';
import { CommandRejection } from './results.ts';
import { transition } from './transitions.ts';
import {
  isParentTask,
  type InteractTask,
  type MoveTask,
  type ParentTask,
  type Task,
} from './types.ts';

export const FORCE_CAPABILITY = 'force-entry';

const OPEN_STATES = new Set<TaskState>(['pending', 'ready', 'running', 'suspended']);

export function isOpen(state: TaskState): boolean {
  return OPEN_STATES.has(state);
}

export function nextIdentifier(world: World, prefix: string): string {
  const id = `${prefix}-${world.nextId}`;
  world.nextId += 1;
  return id;
}

export function clearRoute(entity: Entity | undefined): void {
  if (!entity?.movement) return;
  entity.movement.path = [];
  entity.movement.destination = null;
}

export function countOwned(world: World, responderId: string): number {
  let count = 0;
  for (const item of world.equipment.values()) {
    if (item.ownerId === responderId) count += 1;
  }
  return count;
}

export function carriesCapability(world: World, responderId: string, capability: string): boolean {
  for (const item of world.equipment.values()) {
    if (item.ownerId !== responderId) continue;
    if (hasCapability(world, item, capability)) return true;
  }
  return false;
}

export function hasCapability(world: World, item: EquipmentInstance, capability: string): boolean {
  return world.catalog.get(item.definitionId)?.capabilities.includes(capability) ?? false;
}

export function nearestApproach(world: World, from: Tile, tiles: readonly Tile[]): Tile | null {
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

export function computeInteractionTiles(
  world: Pick<World, 'width' | 'height' | 'blocked'>,
  tile: Tile,
  objectType: 'locker' | 'door' | 'panel',
): Tile[] {
  const candidates: Tile[] = [];
  if (objectType !== 'door') candidates.push({ x: tile.x, y: tile.y });
  candidates.push(
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  );
  return candidates.filter((candidate) =>
    isWalkable(world.width, world.height, world.blocked, candidate),
  );
}

export function storedItems(world: World, lockerId: string): EquipmentInstance[] {
  const order = [...world.catalog.keys()];
  return [...world.equipment.values()]
    .filter((item) => item.locationId === lockerId && item.ownerId === null)
    .sort((left, right) => {
      const leftOrder = order.indexOf(left.definitionId);
      const rightOrder = order.indexOf(right.definitionId);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}

export function reserveItem(task: Task, item: EquipmentInstance): void {
  item.reservedByTaskId = task.id;
  if (!task.reservations.includes(item.id)) task.reservations.push(item.id);
}

export function releaseReservations(world: World, task: Task): void {
  for (const equipmentId of task.reservations) {
    const item = world.equipment.get(equipmentId);
    if (item?.reservedByTaskId === task.id) item.reservedByTaskId = null;
  }
  task.reservations = [];
}

export function giveItem(world: World, task: Task, equipmentId: string): string | null {
  const item = world.equipment.get(equipmentId);
  if (!item) return CommandRejection.EquipmentGone;
  if (item.ownerId === task.assigneeId) return null;
  if (item.ownerId) return CommandRejection.EquipmentGone;
  if (
    item.reservedByTaskId &&
    item.reservedByTaskId !== task.id &&
    !reservationHeldBy(world, task, equipmentId)
  ) {
    return CommandRejection.Reserved;
  }
  if (countOwned(world, task.assigneeId) >= world.inventoryCapacity) {
    return CommandRejection.InventoryFull;
  }
  item.ownerId = task.assigneeId;
  item.locationId = null;
  item.reservedByTaskId = null;
  for (const candidate of world.tasks.values()) {
    candidate.reservations = candidate.reservations.filter((id) => id !== equipmentId);
  }
  return null;
}

export function rootTask(world: World, task: Task): Task {
  let current = task;
  while (current.parentId) {
    const parent = world.tasks.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function cancelTask(world: World, task: Task): void {
  const root = rootTask(world, task);
  if (!isOpen(root.state)) return;
  closeDescendants(world, root.id, true);
  transition(root, 'cancelled');
  root.suspendedByTaskId = undefined;
  releaseReservations(world, root);
  if (isParentTask(root)) root.childTaskId = undefined;
  clearRoute(world.entities.get(root.assigneeId));
}

export function failTask(world: World, task: Task, reason: string): void {
  if (!isOpen(task.state)) return;
  closeDescendants(world, task.id, true);
  transition(task, 'failed');
  task.failureReason = reason;
  task.suspendedByTaskId = undefined;
  releaseReservations(world, task);
  if (isParentTask(task)) task.childTaskId = undefined;
  clearRoute(world.entities.get(task.assigneeId));
}

export function completeTask(world: World, task: Task): void {
  if (task.state !== 'running') return;
  closeDescendants(world, task.id, true);
  if (task.state !== 'running') return;
  transition(task, 'completed');
  releaseReservations(world, task);
  if (isParentTask(task)) task.childTaskId = undefined;
  tryResume(world, task.id);
}

export function parkChildren(world: World, parent: Task): void {
  for (const child of descendants(world, parent.id)) {
    if (!isOpen(child.state)) continue;
    if (isParentTask(parent) && child.kind !== 'move') {
      parent.progressTicks = Math.max(parent.progressTicks, child.progressTicks);
    }
    transferReservations(world, child, parent);
    transition(child, 'cancelled');
    child.suspendedByTaskId = undefined;
  }
  if (isParentTask(parent)) parent.childTaskId = undefined;
  clearRoute(world.entities.get(parent.assigneeId));
}

export function overrideWith(world: World, assigneeId: string, individualTaskId: string): void {
  const roots = [...world.tasks.values()].filter(
    (task) => task.assigneeId === assigneeId && !task.parentId && task.id !== individualTaskId,
  );
  for (const task of roots) {
    if (!isOpen(task.state)) continue;
    if (task.source === 'individual') {
      cancelTask(world, task);
      continue;
    }
    if (task.state === 'running') {
      parkChildren(world, task);
      transition(task, 'suspended');
      task.suspendedByTaskId = individualTaskId;
      continue;
    }
    if (task.state === 'suspended') task.suspendedByTaskId = individualTaskId;
  }
}

export function spawnMove(world: World, parent: ParentTask, destination: Tile): MoveTask {
  const task: MoveTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'move',
    state: 'pending',
    assigneeId: parent.assigneeId,
    source: parent.source,
    destination: { ...destination },
    parentId: parent.id,
    reservations: [],
  };
  if (parent.groupId) task.groupId = parent.groupId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  parent.childTaskId = task.id;
  parent.approachTile = { ...destination };
  parent.step = 'move-to';
  clearRoute(world.entities.get(parent.assigneeId));
  return task;
}

export function spawnInteract(
  world: World,
  parent: ParentTask,
  action: InteractTask['action'],
  durationTicks: number,
  initialProgress = 0,
): InteractTask {
  const task: InteractTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'interact',
    state: 'pending',
    assigneeId: parent.assigneeId,
    source: parent.source,
    targetId: parent.targetId,
    action,
    step: 'interact',
    progressTicks: initialProgress,
    durationTicks,
    parentId: parent.id,
    reservations: [],
  };
  if (parent.groupId) task.groupId = parent.groupId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  parent.childTaskId = task.id;
  parent.step = 'interact';
  parent.progressTicks = initialProgress;
  parent.durationTicks = durationTicks;
  return task;
}

export function tryResume(world: World, completedTaskId: string): void {
  for (const task of [...world.tasks.values()]) {
    if (task.state !== 'suspended' || task.suspendedByTaskId !== completedTaskId) continue;
    const reason = invalidReason(world, task);
    if (reason) {
      failTask(world, task, reason);
      continue;
    }
    transition(task, 'running');
    task.suspendedByTaskId = undefined;
    clearRoute(world.entities.get(task.assigneeId));
  }
}

function invalidReason(world: World, task: Task): string | null {
  const entity = world.entities.get(task.assigneeId);
  if (!entity?.position) return CommandRejection.UnknownResponder;
  const from = tileOf(entity.position);
  switch (task.kind) {
    case 'move':
      return findPath(world, from, task.destination) ? null : CommandRejection.NoPath;
    case 'interact':
      return null;
    case 'retrieve-equipment':
      return invalidRetrieve(world, task, from);
    case 'force-door':
      return invalidForce(world, task, from);
    case 'operate-panel':
      return invalidOperate(world, task, from);
    default: {
      const unreachable: never = task;
      return unreachable;
    }
  }
}

function invalidRetrieve(
  world: World,
  task: ParentTask & { equipmentId?: string },
  from: Tile,
): string | null {
  const item = task.equipmentId ? world.equipment.get(task.equipmentId) : undefined;
  if (!item) return CommandRejection.EquipmentGone;
  if (item.ownerId === task.assigneeId) return null;
  if (item.ownerId) return CommandRejection.EquipmentGone;
  if (item.reservedByTaskId !== task.id && !task.reservations.includes(item.id)) {
    return CommandRejection.EquipmentGone;
  }
  if (countOwned(world, task.assigneeId) >= world.inventoryCapacity) {
    return CommandRejection.InventoryFull;
  }
  const locker = world.entities.get(task.targetId);
  if (locker?.interactable?.objectType !== 'locker') return CommandRejection.UnknownObject;
  if (task.approachTile && !findPath(world, from, task.approachTile))
    return CommandRejection.NoPath;
  return null;
}

function invalidForce(world: World, task: ParentTask, from: Tile): string | null {
  const door = world.entities.get(task.targetId);
  if (door?.interactable?.objectType !== 'door') return CommandRejection.UnknownObject;
  if (door.interactable.state !== 'locked') return CommandRejection.DoorOpen;
  const owned = carriesCapability(world, task.assigneeId, FORCE_CAPABILITY);
  if (task.step === 'acquire') {
    const reserved = task.reservations.some((id) => {
      const item = world.equipment.get(id);
      return item ? hasCapability(world, item, FORCE_CAPABILITY) : false;
    });
    if (!owned && !reserved) return CommandRejection.ToolRequired;
  } else if (!owned) {
    return CommandRejection.ToolRequired;
  }
  if (task.step !== 'acquire' && task.approachTile && !findPath(world, from, task.approachTile)) {
    return CommandRejection.NoPath;
  }
  return null;
}

function invalidOperate(world: World, task: ParentTask, from: Tile): string | null {
  const panel = world.entities.get(task.targetId);
  if (panel?.interactable?.objectType !== 'panel') return CommandRejection.UnknownObject;
  if (panel.interactable.state !== 'idle') return CommandRejection.PanelUsed;
  if (task.approachTile && !findPath(world, from, task.approachTile))
    return CommandRejection.NoPath;
  return null;
}

function reservationHeldBy(world: World, task: Task, equipmentId: string): boolean {
  let current: Task | undefined = task;
  while (current) {
    if (current.reservations.includes(equipmentId)) return true;
    current = current.parentId ? world.tasks.get(current.parentId) : undefined;
  }
  return false;
}

function descendants(world: World, rootId: string): Task[] {
  const result: Task[] = [];
  const walk = (parentId: string): void => {
    const children = [...world.tasks.values()]
      .filter((task) => task.parentId === parentId)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    for (const child of children) {
      result.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  return result;
}

function closeDescendants(world: World, rootId: string, release: boolean): void {
  const root = world.tasks.get(rootId);
  for (const child of descendants(world, rootId)) {
    if (!isOpen(child.state)) continue;
    if (release || !root) releaseReservations(world, child);
    else transferReservations(world, child, root);
    transition(child, 'cancelled');
    child.suspendedByTaskId = undefined;
  }
}

function transferReservations(world: World, from: Task, to: Task): void {
  for (const equipmentId of from.reservations) {
    const item = world.equipment.get(equipmentId);
    if (item?.reservedByTaskId === from.id) item.reservedByTaskId = to.id;
    if (!to.reservations.includes(equipmentId)) to.reservations.push(equipmentId);
  }
  from.reservations = [];
}
