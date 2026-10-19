import type { Command, Tile } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { tileOf } from '../navigation/grid.ts';
import {
  carriedSuppress,
  evaluateIncidents,
  findStoredSuppress,
  inSuppressionRange,
  nearestReachable,
  rangeTiles,
} from './fireRules.ts';
import {
  cancelTask,
  completeTask,
  countOwned,
  failTask,
  isOpen,
  nextIdentifier,
  overrideWith,
  reserveItem,
  spawnMove,
} from './lifecycle.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type {
  RetrieveEquipmentTask,
  SuppressFireTask,
  SuppressIncidentTask,
  Task,
} from './types.ts';
import { blocksPedestrian } from './vehicleRules.ts';

type SuppressionCommand = Extract<Command, { type: 'suppress-fire' | 'suppress-incident' }>;

export function applySuppressionCommand(world: World, command: SuppressionCommand): CommandResult {
  switch (command.type) {
    case 'suppress-fire':
      return suppressFire(world, command.responderId, command.fireId, 'individual');
    case 'suppress-incident':
      return suppressIncident(world, command.teamId, command.incidentId);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

export function advanceSuppressionTask(world: World, task: Task): void {
  if (task.kind === 'suppress-fire') advanceSuppress(world, task);
  else if (task.kind === 'suppress-incident') advanceIncident(world, task);
}

function suppressFire(
  world: World,
  responderId: string,
  fireId: string,
  source: 'team' | 'individual',
  groupId?: string,
  parentId?: string,
): CommandResult {
  const planned = planSuppress(world, responderId, fireId);
  if (!planned.ok) return planned;
  const task: SuppressFireTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'suppress-fire',
    state: 'pending',
    assigneeId: responderId,
    source,
    targetId: fireId,
    step: planned.carried ? 'move-to' : 'acquire',
    approachTile: { ...planned.approach },
    equipmentId: planned.equipmentId,
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  if (groupId) task.groupId = groupId;
  if (parentId) task.parentId = parentId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  if (!parentId && source === 'individual') overrideWith(world, responderId, task.id);
  if (!planned.carried) startAcquire(world, task, planned.equipmentId, planned.storageApproach);
  else if (!inSuppressionRange(planned.position, planned.fire))
    spawnMove(world, task, planned.approach);
  else task.step = 'suppress';
  return { ok: true };
}

function suppressIncident(world: World, teamId: string, incidentId: string): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  const incident = world.incidents.get(incidentId);
  if (!incident) return { ok: false, reason: CommandRejection.UnknownIncident };
  if (incident.state === 'resolved')
    return { ok: false, reason: CommandRejection.IncidentResolved };
  const objective = [...world.objectives.values()].find(
    (candidate) => candidate.incidentId === incidentId && candidate.state === 'open',
  );
  if (!objective) return { ok: false, reason: CommandRejection.IncidentResolved };

  const task: SuppressIncidentTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'suppress-incident',
    state: 'pending',
    assigneeId: incidentId,
    source: 'team',
    targetId: incidentId,
    step: 'work',
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
  };
  const groupId = nextIdentifier(world, 'group');
  task.groupId = groupId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);

  let assigned = 0;
  let failure: string = CommandRejection.NoSuppressant;
  for (const memberId of world.team.memberIds) {
    if (occupied(world, memberId)) continue;
    const planned = planSuppress(world, memberId, objective.targetId);
    if (!planned.ok) {
      failure = planned.reason;
      continue;
    }
    cancelTeamRoots(world, memberId);
    const result = suppressFire(world, memberId, objective.targetId, 'team', groupId, task.id);
    if (result.ok) assigned += 1;
    else failure = result.reason ?? failure;
  }
  if (assigned === 0) {
    world.tasks.delete(task.id);
    return { ok: false, reason: failure };
  }
  return { ok: true };
}

function advanceSuppress(world: World, task: SuppressFireTask): void {
  const responder = world.entities.get(task.assigneeId);
  const fire = world.entities.get(task.targetId);
  if (!responder?.responder || !responder.position || !fire?.fire || !fire.position) {
    failTask(world, task, CommandRejection.UnknownFire);
    return;
  }
  if (blocksPedestrian(responder)) {
    failTask(world, task, CommandRejection.Aboard);
    return;
  }
  if (fire.fire.intensity <= 0) {
    evaluateIncidents(world);
    completeTask(world, task);
    return;
  }
  const child = childStatus(world, task);
  if (child === 'wait' || child === 'suspended') return;
  if (typeof child === 'object') {
    failTask(world, task, child.reason);
    return;
  }
  const carried = carriedSuppress(world, task.assigneeId);
  if (!carried) {
    if (task.step === 'acquire' && child === 'done') {
      failTask(world, task, CommandRejection.NoSuppressant);
      return;
    }
    const stored = findStoredSuppress(world, tileOf(responder.position));
    if (!stored) {
      failTask(world, task, CommandRejection.NoSuppressant);
      return;
    }
    if (countOwned(world, task.assigneeId) >= world.inventoryCapacity) {
      failTask(world, task, CommandRejection.InventoryFull);
      return;
    }
    startAcquire(world, task, stored.item.id, stored.approach);
    return;
  }
  if (!inSuppressionRange(responder.position, fire)) {
    const tiles = rangeTiles(world, tileOf(fire.position), fire.fire.range);
    const approach = nearestReachable(world, tileOf(responder.position), tiles);
    if (!approach) {
      failTask(world, task, CommandRejection.NoPath);
      return;
    }
    task.approachTile = { ...approach };
    spawnMove(world, task, approach);
    return;
  }
  const rate = world.catalog.get(carried.definitionId)?.suppression ?? 0;
  if (rate <= 0 || (carried.agent ?? 0) <= 0) {
    failTask(world, task, CommandRejection.AgentSpent);
    return;
  }
  carried.agent = (carried.agent ?? 0) - 1;
  fire.fire.intensity = Math.max(0, fire.fire.intensity - rate);
  task.step = 'suppress';
  task.progressTicks += 1;
  if (fire.fire.intensity <= 0) {
    evaluateIncidents(world);
    completeTask(world, task);
    return;
  }
  if ((carried.agent ?? 0) <= 0) failTask(world, task, CommandRejection.AgentSpent);
}

function advanceIncident(world: World, task: SuppressIncidentTask): void {
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
  const children = [...world.tasks.values()].filter(
    (candidate) => candidate.parentId === task.id && candidate.kind === 'suppress-fire',
  );
  if (
    children.some(
      (child) => child.state === 'running' || child.state === 'pending' || child.state === 'ready',
    )
  ) {
    return;
  }
  for (const child of children) {
    if (child.state === 'suspended') releaseStoredReservations(world, child);
  }
  const objective = [...world.objectives.values()].find(
    (candidate) => candidate.incidentId === incident.id && candidate.state === 'open',
  );
  const assigned = new Set(
    children.filter((child) => isOpen(child.state)).map((child) => child.assigneeId),
  );
  let replacements = 0;
  if (objective) {
    for (const memberId of world.team.memberIds) {
      if (assigned.has(memberId) || occupied(world, memberId)) continue;
      if (!planSuppress(world, memberId, objective.targetId).ok) continue;
      cancelTeamRoots(world, memberId);
      if (suppressFire(world, memberId, objective.targetId, 'team', task.groupId, task.id).ok) {
        replacements += 1;
      }
    }
  }
  if (replacements > 0) return;
  if (children.some((child) => child.state === 'suspended')) return;
  failTask(world, task, CommandRejection.NoSuppressant);
}

function startAcquire(
  world: World,
  parent: SuppressFireTask,
  equipmentId: string,
  approach: Tile,
): void {
  const item = world.equipment.get(equipmentId);
  if (!item) {
    failTask(world, parent, CommandRejection.NoSuppressant);
    return;
  }
  const task: RetrieveEquipmentTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'retrieve-equipment',
    state: 'pending',
    assigneeId: parent.assigneeId,
    source: parent.source,
    targetId: item.locationId ?? parent.targetId,
    definitionId: item.definitionId,
    equipmentId: item.id,
    step: 'move-to',
    approachTile: { ...approach },
    progressTicks: 0,
    durationTicks: 0,
    reservations: [],
    parentId: parent.id,
  };
  if (parent.groupId) task.groupId = parent.groupId;
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  if (item.reservedByTaskId === null) reserveItem(parent, item);
  parent.childTaskId = task.id;
  parent.step = 'acquire';
  parent.equipmentId = item.id;
  spawnMove(world, task, approach);
}

function planSuppress(
  world: World,
  responderId: string,
  fireId: string,
):
  | {
      ok: true;
      approach: Tile;
      equipmentId: string;
      carried: boolean;
      storageApproach: Tile;
      position: { x: number; y: number };
      fire: NonNullable<ReturnType<World['entities']['get']>>;
    }
  | { ok: false; reason: string } {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  if (blocksPedestrian(entity)) return { ok: false, reason: CommandRejection.Aboard };
  const fire = world.entities.get(fireId);
  if (!fire?.fire || !fire.position) return { ok: false, reason: CommandRejection.UnknownFire };
  if (fire.fire.intensity <= 0) return { ok: false, reason: CommandRejection.FireOut };
  const origin = tileOf(entity.position);
  const approach = nearestReachable(
    world,
    origin,
    rangeTiles(world, tileOf(fire.position), fire.fire.range),
  );
  if (!approach) return { ok: false, reason: CommandRejection.NoPath };
  const carried = carriedSuppress(world, responderId);
  if (carried) {
    return {
      ok: true,
      approach,
      equipmentId: carried.id,
      carried: true,
      storageApproach: approach,
      position: entity.position,
      fire,
    };
  }
  if (countOwned(world, responderId) >= world.inventoryCapacity) {
    return { ok: false, reason: CommandRejection.InventoryFull };
  }
  const stored = findStoredSuppress(world, origin);
  if (!stored) return { ok: false, reason: CommandRejection.NoSuppressant };
  return {
    ok: true,
    approach,
    equipmentId: stored.item.id,
    carried: false,
    storageApproach: stored.approach,
    position: entity.position,
    fire,
  };
}

function occupied(world: World, responderId: string): boolean {
  const entity = world.entities.get(responderId);
  if (entity?.responder?.aboardVehicleId) return true;
  return [...world.tasks.values()].some(
    (task) =>
      task.assigneeId === responderId &&
      isOpen(task.state) &&
      (task.source === 'individual' ||
        task.kind === 'board-vehicle' ||
        task.kind === 'exit-vehicle' ||
        task.kind === 'suppress-fire'),
  );
}

function cancelTeamRoots(world: World, assigneeId: string): void {
  for (const task of [...world.tasks.values()]) {
    if (
      task.assigneeId === assigneeId &&
      !task.parentId &&
      task.source === 'team' &&
      isOpen(task.state)
    ) {
      cancelTask(world, task);
    }
  }
}

function releaseStoredReservations(world: World, task: Task): void {
  for (const equipmentId of [...task.reservations]) {
    const item = world.equipment.get(equipmentId);
    if (!item || item.reservedByTaskId !== task.id || item.ownerId) continue;
    item.reservedByTaskId = null;
    task.reservations = task.reservations.filter((id) => id !== equipmentId);
  }
}

function childStatus(
  world: World,
  task: SuppressFireTask,
): 'none' | 'wait' | 'done' | 'suspended' | { reason: string; status: 'failed' } {
  if (!task.childTaskId) return 'none';
  const child = world.tasks.get(task.childTaskId);
  if (!child || child.state === 'cancelled') return 'none';
  if (child.state === 'failed') {
    return { status: 'failed', reason: child.failureReason ?? CommandRejection.NoSuppressant };
  }
  if (child.state === 'completed') return 'done';
  if (child.state === 'suspended') return 'suspended';
  return 'wait';
}
