import type { Tile } from '@emergency/protocol';

import type { EquipmentInstance } from '../components/equipment.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { tileKey, tileOf } from '../navigation/grid.ts';
import {
  FORCE_CAPABILITY,
  cancelTask,
  carriesCapability,
  completeTask,
  countOwned,
  failTask,
  giveItem,
  hasCapability,
  isOpen,
  nearestApproach,
  nextIdentifier,
  overrideWith,
  reserveItem,
  rootTask,
  spawnInteract,
  spawnMove,
  storedItems,
} from './lifecycle.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type {
  ForceDoorTask,
  OperatePanelTask,
  ParentTask,
  RetrieveEquipmentTask,
  Task,
} from './types.ts';
import { advanceVehicleTask } from './vehicles.ts';
import { approachTiles, blocksPedestrian, canTakeFrom } from './vehicleRules.ts';

const TAKE_TICKS = 10;
const FORCE_TICKS = 40;
const OPERATE_TICKS = 20;

type InteractionCommand =
  | {
      type: 'retrieve-equipment';
      responderId: string;
      lockerId: string;
      definitionId: string;
    }
  | {
      type: 'force-door';
      responderId: string;
      doorId: string;
    }
  | {
      type: 'operate-panel';
      responderId: string;
      panelId: string;
    }
  | {
      type: 'retrieve-team';
      teamId: string;
      lockerId: string;
    }
  | {
      type: 'cancel-task';
      taskId: string;
    };

interface RetrieveCommit {
  assigneeId: string;
  source: 'team' | 'individual';
  lockerId: string;
  definitionId: string;
  equipmentId: string;
  approachTile: Tile;
  groupId?: string;
  parentId?: string;
}

export function applyInteractionCommand(world: World, command: InteractionCommand): CommandResult {
  switch (command.type) {
    case 'retrieve-equipment':
      return retrieveEquipment(world, command.responderId, command.lockerId, command.definitionId);
    case 'force-door':
      return forceDoor(world, command.responderId, command.doorId);
    case 'operate-panel':
      return operatePanel(world, command.responderId, command.panelId);
    case 'retrieve-team':
      return retrieveTeam(world, command.teamId, command.lockerId);
    case 'cancel-task':
      return cancelAssignedTask(world, command.taskId);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export function stepTasks(world: World): void {
  const running = [...world.tasks.values()]
    .filter((task) => task.state === 'running')
    .sort(
      (left, right) =>
        depth(world, right) - depth(world, left) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );

  for (const task of running) {
    if (task.state !== 'running') continue;
    switch (task.kind) {
      case 'move':
        break;
      case 'interact':
        advanceInteract(world, task);
        break;
      case 'retrieve-equipment':
        advanceRetrieve(world, task);
        break;
      case 'force-door':
        advanceForce(world, task);
        break;
      case 'operate-panel':
        advanceOperate(world, task);
        break;
      case 'board-vehicle':
      case 'exit-vehicle':
      case 'respond':
        advanceVehicleTask(world, task);
        break;
      case 'drive-vehicle':
        break;
      default: {
        const unreachable: never = task;
        return unreachable;
      }
    }
  }
}

function retrieveEquipment(
  world: World,
  responderId: string,
  lockerId: string,
  definitionId: string,
): CommandResult {
  const planned = planFreeRetrieve(world, responderId, lockerId, definitionId);
  if (!planned.ok) return planned;
  const task = commitRetrieve(world, {
    assigneeId: responderId,
    source: 'individual',
    lockerId,
    definitionId,
    equipmentId: planned.equipmentId,
    approachTile: planned.approachTile,
  });
  overrideWith(world, responderId, task.id);
  return { ok: true };
}

function forceDoor(world: World, responderId: string, doorId: string): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  if (blocksPedestrian(entity)) return { ok: false, reason: CommandRejection.Aboard };
  const door = world.entities.get(doorId);
  if (door?.interactable?.objectType !== 'door') {
    return { ok: false, reason: CommandRejection.UnknownObject };
  }
  if (door.interactable.state !== 'locked') return { ok: false, reason: CommandRejection.DoorOpen };

  const approach = nearestApproach(
    world,
    tileOf(entity.position),
    door.interactable.interactionTiles,
  );
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };

  const hasTool = carriesCapability(world, responderId, FORCE_CAPABILITY);
  const source = hasTool ? null : findTool(world, entity);
  if (!hasTool && !source) return { ok: false, reason: CommandRejection.ToolRequired };
  if (!hasTool && countOwned(world, responderId) >= world.inventoryCapacity) {
    return { ok: false, reason: CommandRejection.InventoryFull };
  }

  const task: ForceDoorTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'force-door',
    state: 'pending',
    assigneeId: responderId,
    source: 'individual',
    targetId: doorId,
    step: hasTool ? 'move-to' : 'acquire',
    approachTile: { ...approach },
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  overrideWith(world, responderId, task.id);

  if (hasTool) {
    spawnMove(world, task, approach);
  } else if (source?.item.locationId) {
    const child = commitRetrieve(world, {
      assigneeId: responderId,
      source: 'individual',
      lockerId: source.item.locationId,
      definitionId: source.item.definitionId,
      equipmentId: source.item.id,
      approachTile: source.approach,
      parentId: task.id,
    });
    task.childTaskId = child.id;
  }
  return { ok: true };
}

function operatePanel(world: World, responderId: string, panelId: string): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  if (blocksPedestrian(entity)) return { ok: false, reason: CommandRejection.Aboard };
  const panel = world.entities.get(panelId);
  if (panel?.interactable?.objectType !== 'panel') {
    return { ok: false, reason: CommandRejection.UnknownObject };
  }
  if (panel.interactable.state !== 'idle') return { ok: false, reason: CommandRejection.PanelUsed };
  const approach = nearestApproach(
    world,
    tileOf(entity.position),
    panel.interactable.interactionTiles,
  );
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };

  const task: OperatePanelTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'operate-panel',
    state: 'pending',
    assigneeId: responderId,
    source: 'individual',
    targetId: panelId,
    step: 'move-to',
    approachTile: { ...approach },
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  overrideWith(world, responderId, task.id);
  spawnMove(world, task, approach);
  return { ok: true };
}

function retrieveTeam(world: World, teamId: string, lockerId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const locker = world.entities.get(lockerId);
  if (!locker || !canTakeFrom(locker)) {
    return {
      ok: false,
      reason: locker?.vehicle ? CommandRejection.VehicleMoving : CommandRejection.UnknownObject,
    };
  }
  const storageTiles = approachTiles(world, locker);

  const items = storedItems(world, lockerId).filter((item) => item.reservedByTaskId === null);
  if (items.length === 0) {
    const reason = storedItems(world, lockerId).some((item) => item.reservedByTaskId)
      ? CommandRejection.Reserved
      : CommandRejection.NoEquipment;
    return { ok: false, reason };
  }

  const used = new Set<string>();
  const plans: Array<
    | { memberId: string; ok: true; item: EquipmentInstance; approachTile: Tile }
    | { memberId: string; ok: false; reason: string }
  > = [];

  for (const memberId of world.team.memberIds) {
    const entity = world.entities.get(memberId);
    if (!entity?.position) {
      plans.push({ memberId, ok: false, reason: CommandRejection.UnknownResponder });
      continue;
    }
    if (blocksPedestrian(entity)) {
      plans.push({ memberId, ok: false, reason: CommandRejection.Aboard });
      continue;
    }
    if (countOwned(world, memberId) >= world.inventoryCapacity) {
      plans.push({ memberId, ok: false, reason: CommandRejection.InventoryFull });
      continue;
    }
    const item = items.find((candidate) => !used.has(candidate.id));
    if (!item) {
      plans.push({ memberId, ok: false, reason: CommandRejection.NoEquipment });
      continue;
    }
    const approachTile = nearestApproach(world, tileOf(entity.position), storageTiles);
    if (!approachTile) {
      plans.push({ memberId, ok: false, reason: CommandRejection.NoPath });
      continue;
    }
    used.add(item.id);
    plans.push({ memberId, ok: true, item, approachTile });
  }

  const firstFailure = plans.find((plan) => !plan.ok);
  if (firstFailure && !plans.some((plan) => plan.ok)) {
    return { ok: false, reason: firstFailure.reason };
  }

  const groupId = nextIdentifier(world, 'group');
  for (const memberId of world.team.memberIds) cancelOpenRoots(world, memberId);

  for (const plan of plans) {
    if (!plan.ok) {
      failRetrieve(world, plan.memberId, lockerId, groupId, plan.reason);
      continue;
    }
    commitRetrieve(world, {
      assigneeId: plan.memberId,
      source: 'team',
      lockerId,
      definitionId: plan.item.definitionId,
      equipmentId: plan.item.id,
      approachTile: plan.approachTile,
      groupId,
    });
  }
  return { ok: true };
}

function cancelAssignedTask(world: World, taskId: string): CommandResult {
  const task = world.tasks.get(taskId);
  if (!task) return { ok: false, reason: CommandRejection.UnknownTask };
  const root = rootTask(world, task);
  if (!isOpen(root.state)) return { ok: false, reason: CommandRejection.Finished };
  cancelTask(world, root);
  return { ok: true };
}

function planFreeRetrieve(
  world: World,
  responderId: string,
  lockerId: string,
  definitionId: string,
): { ok: true; equipmentId: string; approachTile: Tile } | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  if (blocksPedestrian(entity)) return { ok: false, reason: CommandRejection.Aboard };
  const locker = world.entities.get(lockerId);
  if (!locker || !canTakeFrom(locker)) {
    return {
      ok: false,
      reason: locker?.vehicle ? CommandRejection.VehicleMoving : CommandRejection.UnknownObject,
    };
  }
  if (countOwned(world, responderId) >= world.inventoryCapacity) {
    return { ok: false, reason: CommandRejection.InventoryFull };
  }
  const matching = storedItems(world, lockerId).filter(
    (item) => item.definitionId === definitionId,
  );
  const free = matching.find((item) => item.reservedByTaskId === null);
  if (!free) {
    return {
      ok: false,
      reason: matching.some((item) => item.reservedByTaskId)
        ? CommandRejection.Reserved
        : CommandRejection.NoEquipment,
    };
  }
  const approachTile = nearestApproach(
    world,
    tileOf(entity.position),
    approachTiles(world, locker),
  );
  if (!approachTile) return { ok: false, reason: CommandRejection.NoPath };
  return { ok: true, equipmentId: free.id, approachTile };
}

function commitRetrieve(world: World, input: RetrieveCommit): RetrieveEquipmentTask {
  const task: RetrieveEquipmentTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'retrieve-equipment',
    state: 'pending',
    assigneeId: input.assigneeId,
    source: input.source,
    targetId: input.lockerId,
    definitionId: input.definitionId,
    equipmentId: input.equipmentId,
    step: 'move-to',
    approachTile: { ...input.approachTile },
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (input.groupId) task.groupId = input.groupId;
  if (input.parentId) task.parentId = input.parentId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);

  const item = world.equipment.get(input.equipmentId);
  if (item && item.reservedByTaskId === null) reserveItem(task, item);
  spawnMove(world, task, input.approachTile);
  return task;
}

function failRetrieve(
  world: World,
  assigneeId: string,
  lockerId: string,
  groupId: string,
  reason: string,
): void {
  const definitionId = world.catalog.keys().next().value ?? 'none';
  const task: RetrieveEquipmentTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'retrieve-equipment',
    state: 'pending',
    assigneeId,
    source: 'team',
    groupId,
    targetId: lockerId,
    definitionId,
    step: 'move-to',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  transition(task, 'failed');
  task.failureReason = reason;
  world.tasks.set(task.id, task);
}

function findTool(
  world: World,
  entity: Entity,
): { item: EquipmentInstance; approach: Tile } | null {
  if (!entity.position) return null;
  const origin = tileOf(entity.position);
  let best: { item: EquipmentInstance; approach: Tile; length: number } | null = null;
  for (const item of world.equipment.values()) {
    if (item.ownerId || item.reservedByTaskId || !item.locationId) continue;
    if (!hasCapability(world, item, FORCE_CAPABILITY)) continue;
    const storage = world.entities.get(item.locationId);
    if (!storage || !canTakeFrom(storage)) continue;
    const approach = nearestApproach(world, origin, approachTiles(world, storage));
    if (!approach) continue;
    const length = Math.abs(approach.x - origin.x) + Math.abs(approach.y - origin.y);
    if (!best || length < best.length || (length === best.length && item.id < best.item.id)) {
      best = { item, approach, length };
    }
  }
  return best ? { item: best.item, approach: best.approach } : null;
}

function advanceInteract(world: World, task: Task & { kind: 'interact' }): void {
  const target = world.entities.get(task.targetId);
  const entity = world.entities.get(task.assigneeId);
  const tiles = target ? approachTiles(world, target) : [];
  const standing = entity?.position ? tileOf(entity.position) : undefined;
  if (!standing || !tiles.some((tile) => tile.x === standing.x && tile.y === standing.y)) {
    failTask(world, task, CommandRejection.NotAtPosition);
    return;
  }
  task.progressTicks += 1;
  const parent = task.parentId ? world.tasks.get(task.parentId) : undefined;
  if (parent && parent.kind !== 'move' && parent.kind !== 'interact') {
    parent.progressTicks = task.progressTicks;
    parent.durationTicks = task.durationTicks;
    parent.step = 'interact';
  }
  if (task.progressTicks >= task.durationTicks) completeTask(world, task);
}

function advanceRetrieve(world: World, task: RetrieveEquipmentTask): void {
  const item = task.equipmentId ? world.equipment.get(task.equipmentId) : undefined;
  if (item?.ownerId === task.assigneeId) {
    completeTask(world, task);
    return;
  }
  const child = viewChild(world, task);
  if (child.status === 'wait') return;
  if (child.status === 'failed') {
    failTask(world, task, child.reason);
    return;
  }
  if (child.status === 'done') {
    if (task.step === 'move-to') {
      spawnInteract(world, task, 'take', TAKE_TICKS);
      return;
    }
    const reason = task.equipmentId
      ? giveItem(world, task, task.equipmentId)
      : CommandRejection.EquipmentGone;
    if (reason) failTask(world, task, reason);
    else completeTask(world, task);
    return;
  }
  if (task.step === 'interact') {
    spawnInteract(world, task, 'take', TAKE_TICKS, task.progressTicks);
    return;
  }
  if (task.approachTile) spawnMove(world, task, task.approachTile);
}

function advanceForce(world: World, task: ForceDoorTask): void {
  const door = world.entities.get(task.targetId);
  if (door?.interactable?.objectType !== 'door') {
    failTask(world, task, CommandRejection.UnknownObject);
    return;
  }
  if (door.interactable.state !== 'locked') {
    failTask(world, task, CommandRejection.DoorOpen);
    return;
  }
  const child = viewChild(world, task);
  if (child.status === 'wait') return;
  if (child.status === 'failed') {
    failTask(world, task, child.reason);
    return;
  }
  if (child.status === 'done') {
    if (task.step === 'acquire') {
      if (task.approachTile) spawnMove(world, task, task.approachTile);
      return;
    }
    if (task.step === 'move-to') {
      spawnInteract(world, task, 'force', FORCE_TICKS);
      return;
    }
    openDoor(world, door);
    completeTask(world, task);
    return;
  }
  if (task.step === 'acquire') {
    if (carriesCapability(world, task.assigneeId, FORCE_CAPABILITY)) {
      if (task.approachTile) spawnMove(world, task, task.approachTile);
      return;
    }
    resumeAcquire(world, task);
    return;
  }
  if (task.step === 'move-to' && task.approachTile) {
    spawnMove(world, task, task.approachTile);
    return;
  }
  if (task.step === 'interact')
    spawnInteract(world, task, 'force', FORCE_TICKS, task.progressTicks);
}

function advanceOperate(world: World, task: OperatePanelTask): void {
  const panel = world.entities.get(task.targetId);
  if (panel?.interactable?.objectType !== 'panel') {
    failTask(world, task, CommandRejection.UnknownObject);
    return;
  }
  if (panel.interactable.state !== 'idle') {
    failTask(world, task, CommandRejection.PanelUsed);
    return;
  }
  const child = viewChild(world, task);
  if (child.status === 'wait') return;
  if (child.status === 'failed') {
    failTask(world, task, child.reason);
    return;
  }
  if (child.status === 'done') {
    if (task.step === 'move-to') {
      spawnInteract(world, task, 'operate', OPERATE_TICKS);
      return;
    }
    panel.interactable.state = 'operated';
    completeTask(world, task);
    return;
  }
  if (task.step === 'interact') {
    spawnInteract(world, task, 'operate', OPERATE_TICKS, task.progressTicks);
    return;
  }
  if (task.approachTile) spawnMove(world, task, task.approachTile);
}

function resumeAcquire(world: World, task: ForceDoorTask): void {
  const reserved = [...task.reservations]
    .map((id) => world.equipment.get(id))
    .find((item): item is EquipmentInstance =>
      Boolean(item && item.locationId && hasCapability(world, item, FORCE_CAPABILITY)),
    );
  const entity = world.entities.get(task.assigneeId);
  if (!reserved?.locationId || !entity?.position) {
    failTask(world, task, CommandRejection.ToolRequired);
    return;
  }
  const locker = world.entities.get(reserved.locationId);
  const approach = locker?.interactable
    ? nearestApproach(world, tileOf(entity.position), locker.interactable.interactionTiles)
    : null;
  if (!approach) {
    failTask(world, task, CommandRejection.NoPath);
    return;
  }
  const child = commitRetrieve(world, {
    assigneeId: task.assigneeId,
    source: task.source,
    lockerId: reserved.locationId,
    definitionId: reserved.definitionId,
    equipmentId: reserved.id,
    approachTile: approach,
    parentId: task.id,
    ...(task.groupId ? { groupId: task.groupId } : {}),
  });
  task.childTaskId = child.id;
  task.step = 'acquire';
}

function openDoor(world: World, door: Entity): void {
  if (!door.interactable || !door.position) return;
  door.interactable.state = 'open';
  world.blocked.delete(tileKey(tileOf(door.position)));
}

function viewChild(
  world: World,
  task: ParentTask,
): { status: 'wait' | 'absent' | 'done' } | { status: 'failed'; reason: string } {
  if (!task.childTaskId) return { status: 'absent' };
  const child = world.tasks.get(task.childTaskId);
  if (!child) return { status: 'absent' };
  if (child.state === 'completed') return { status: 'done' };
  if (child.state === 'failed' || child.state === 'cancelled') {
    return { status: 'failed', reason: child.failureReason ?? CommandRejection.Cancelled };
  }
  if (isOpen(child.state)) return { status: 'wait' };
  return { status: 'absent' };
}

function cancelOpenRoots(world: World, assigneeId: string): void {
  for (const task of [...world.tasks.values()]) {
    if (task.assigneeId !== assigneeId || task.parentId || !isOpen(task.state)) continue;
    cancelTask(world, task);
  }
}

function depth(world: World, task: Task): number {
  let level = 0;
  let current = task;
  while (current.parentId) {
    level += 1;
    const parent = world.tasks.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return level;
}
