import type { Command, Tile } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { findPath } from '../navigation/aStar.ts';
import { inBounds, isBlocked, isWalkable, manhattan, tileOf } from '../navigation/grid.ts';
import { applyInteractionCommand } from './interactions.ts';
import { cancelTask, clearRoute, isOpen, nextIdentifier, overrideWith } from './lifecycle.ts';
import { noteOrderRejected, noteUnreachable } from './notices.ts';
import {
  cancelOrder,
  clearOrders,
  enqueueOrder,
  isPromoting,
  responderBusy,
  setPromoting,
  takeNextOrder,
} from './orders.ts';
import { CommandRejection, type CommandResult } from './results.ts';
import { transition } from './transitions.ts';
import type { MoveTask } from './types.ts';
import { applySuppressionCommand } from './suppression.ts';
import { applyVehicleCommand } from './vehicles.ts';
import { blocksPedestrian } from './vehicleRules.ts';
import { applyWaterCommand } from './water.ts';
import { attackLimit } from './waterRules.ts';

export { CommandRejection, type CommandResult } from './results.ts';

/** Nearby walkable tiles considered when spacing a team around an order. */
const STAGING_CANDIDATES = 16;

export function applyCommand(world: World, command: Command): CommandResult {
  if (command.type === 'enqueue') {
    const queued = enqueueOrder(world, command.order);
    if (queued.ok) promoteQueued(world);
    return queued;
  }
  if (command.type === 'cancel-order') return cancelOrder(world, command.orderId);
  const result = dispatchCommand(world, command);
  if (result.ok && !isPromoting()) clearOrders(world, queueAssignees(world, command));
  return result;
}

export function promoteQueued(world: World): void {
  if (isPromoting()) return;
  setPromoting(true);
  try {
    const assignees = [...new Set(world.orders.map((order) => order.command.responderId))];
    for (const assigneeId of assignees) {
      while (!responderBusy(world, assigneeId)) {
        const order = takeNextOrder(world, assigneeId);
        if (!order) break;
        const result = applyCommand(world, order.command);
        if (!result.ok) {
          noteOrderRejected(world, order.id, assigneeId, result.reason ?? 'Order rejected');
          continue;
        }
        if (responderBusy(world, assigneeId)) break;
      }
    }
  } finally {
    setPromoting(false);
  }
}

function dispatchCommand(world: World, command: Command): CommandResult {
  switch (command.type) {
    case 'pause':
      world.paused = true;
      return { ok: true };
    case 'resume':
      world.paused = false;
      return { ok: true };
    case 'move-responder':
      return moveResponder(world, command.responderId, command.destination);
    case 'move-team':
      return moveTeam(world, command.teamId, command.destination);
    case 'retrieve-equipment':
    case 'force-door':
    case 'operate-panel':
    case 'retrieve-team':
    case 'cancel-task':
      return applyInteractionCommand(world, command);
    case 'board-vehicle':
    case 'exit-vehicle':
    case 'board-team':
    case 'disembark-team':
    case 'drive-vehicle':
    case 'respond-to':
      return applyVehicleCommand(world, command);
    case 'suppress-fire':
    case 'suppress-incident':
      return applySuppressionCommand(world, command);
    case 'connect-supply':
    case 'disconnect-supply':
    case 'open-supply':
    case 'close-supply':
    case 'start-pump':
    case 'stop-pump':
    case 'deploy-attack':
    case 'operate-nozzle':
    case 'reposition-nozzle':
    case 'disconnect-attack':
    case 'establish-fire-attack':
      return applyWaterCommand(world, command);
    case 'move-group':
      return moveGroup(world, command.responderIds, command.destination);
    case 'enqueue':
    case 'cancel-order':
      return { ok: false, reason: CommandRejection.Unsupported };
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

function queueAssignees(world: World, command: Command): string[] {
  switch (command.type) {
    case 'move-team':
    case 'retrieve-team':
    case 'board-team':
    case 'disembark-team':
    case 'respond-to':
    case 'suppress-incident':
    case 'establish-fire-attack':
      return [...world.team.memberIds];
    case 'move-group':
      return [...command.responderIds];
    case 'pause':
    case 'resume':
    case 'cancel-task':
    case 'drive-vehicle':
    case 'enqueue':
    case 'cancel-order':
      return [];
    default:
      return [command.responderId];
  }
}

function moveResponder(world: World, responderId: string, destination: Tile): CommandResult {
  const entity = world.entities.get(responderId);
  if (!entity?.responder || !entity.position) {
    return { ok: false, reason: CommandRejection.UnknownResponder };
  }
  const aboard = blocksPedestrian(entity);
  if (aboard) return { ok: false, reason: aboard };
  if (!inBounds(world.width, world.height, destination)) {
    return { ok: false, reason: CommandRejection.OutOfBounds };
  }
  if (isBlocked(world.blocked, destination)) {
    return { ok: false, reason: CommandRejection.Blocked };
  }
  if (!findPath(world, tileOf(entity.position), destination)) {
    return { ok: false, reason: CommandRejection.NoPath };
  }
  const hoseLimit = attackLimit(world, responderId, destination);
  if (hoseLimit) return { ok: false, reason: hoseLimit };

  const task = createMoveTask(world, {
    assigneeId: responderId,
    source: 'individual',
    destination,
    reachable: true,
  });
  overrideWith(world, responderId, task.id);
  clearRoute(entity);
  return { ok: true };
}

function moveTeam(world: World, teamId: string, destination: Tile): CommandResult {
  if (world.team.id !== teamId) return { ok: false, reason: CommandRejection.UnknownTeam };
  if (!inBounds(world.width, world.height, destination)) {
    return { ok: false, reason: CommandRejection.OutOfBounds };
  }

  const assignments = new Map<string, Tile | null>();
  const failure = new Map<string, string>();
  const used = new Set<string>();
  const candidates = candidateTiles(world, destination);

  for (const memberId of world.team.memberIds) {
    const entity = world.entities.get(memberId);
    if (!entity?.position) {
      assignments.set(memberId, null);
      failure.set(memberId, CommandRejection.UnknownResponder);
      continue;
    }
    if (entity.responder?.aboardVehicleId) {
      assignments.set(memberId, null);
      failure.set(memberId, CommandRejection.Aboard);
      continue;
    }
    const start = tileOf(entity.position);
    let chosen: Tile | null = null;
    for (const tile of candidates) {
      const key = `${tile.x},${tile.y}`;
      if (used.has(key)) continue;
      if (!findPath(world, start, tile)) continue;
      chosen = tile;
      used.add(key);
      break;
    }
    assignments.set(memberId, chosen);
  }

  if ([...assignments.values()].every((tile) => tile === null)) {
    return { ok: false, reason: failure.values().next().value ?? CommandRejection.NoPath };
  }

  const groupId = nextIdentifier(world, 'group');
  for (const memberId of world.team.memberIds) {
    for (const task of [...world.tasks.values()]) {
      if (task.assigneeId === memberId && !task.parentId && isOpen(task.state))
        cancelTask(world, task);
    }
    const tile = assignments.get(memberId) ?? null;
    createMoveTask(world, {
      assigneeId: memberId,
      source: 'team',
      groupId,
      destination: tile ?? destination,
      reachable: tile !== null,
      failureReason: failure.get(memberId),
    });
    const entity = world.entities.get(memberId);
    if (entity) clearRoute(entity);
  }

  return { ok: true };
}

function moveGroup(world: World, responderIds: string[], destination: Tile): CommandResult {
  const unique = [...new Set(responderIds)];
  if (!inBounds(world.width, world.height, destination)) {
    return { ok: false, reason: CommandRejection.OutOfBounds };
  }

  const candidates = candidateTiles(world, destination);
  const used = new Set<string>();
  const plans: { id: string; tile: Tile | null; reason?: string }[] = [];

  for (const responderId of unique) {
    const entity = world.entities.get(responderId);
    if (!entity?.responder || !entity.position) {
      plans.push({ id: responderId, tile: null, reason: CommandRejection.UnknownResponder });
      continue;
    }
    const aboard = blocksPedestrian(entity);
    if (aboard) {
      plans.push({ id: responderId, tile: null, reason: aboard });
      continue;
    }
    const start = tileOf(entity.position);
    let chosen: Tile | null = null;
    for (const tile of candidates) {
      const key = `${tile.x},${tile.y}`;
      if (used.has(key)) continue;
      if (!findPath(world, start, tile)) continue;
      if (attackLimit(world, responderId, tile)) continue;
      chosen = tile;
      used.add(key);
      break;
    }
    const plan: { id: string; tile: Tile | null; reason?: string } = { id: responderId, tile: chosen };
    if (!chosen) plan.reason = CommandRejection.NoPath;
    plans.push(plan);
  }

  if (plans.every((plan) => plan.tile === null)) {
    return { ok: false, reason: plans[0]?.reason ?? CommandRejection.NoPath };
  }

  const groupId = nextIdentifier(world, 'group');
  for (const plan of plans) {
    if (plan.reason === CommandRejection.UnknownResponder) continue;
    const task = createMoveTask(world, {
      assigneeId: plan.id,
      source: 'individual',
      groupId,
      destination: plan.tile ?? destination,
      reachable: plan.tile !== null,
      ...(plan.reason ? { failureReason: plan.reason } : {}),
    });
    overrideWith(world, plan.id, task.id);
    const entity = world.entities.get(plan.id);
    if (entity) clearRoute(entity);
  }

  return { ok: true };
}

function createMoveTask(
  world: World,
  input: {
    assigneeId: string;
    source: MoveTask['source'];
    destination: Tile;
    reachable: boolean;
    failureReason?: string;
    groupId?: string;
  },
): MoveTask {
  const task: MoveTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'move',
    state: 'pending',
    assigneeId: input.assigneeId,
    source: input.source,
    destination: { ...input.destination },
    reservations: [],
  };
  if (input.groupId) task.groupId = input.groupId;

  if (!input.reachable) {
    transition(task, 'failed');
    task.failureReason = input.failureReason ?? CommandRejection.NoPath;
    if ((input.failureReason ?? CommandRejection.NoPath) === CommandRejection.NoPath) {
      noteUnreachable(world, input.assigneeId, task.id);
    }
  } else {
    transition(task, 'ready');
    transition(task, 'running');
  }

  world.tasks.set(task.id, task);
  return task;
}

function candidateTiles(world: World, goal: Tile): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const tile = { x, y };
      if (!isWalkable(world.width, world.height, world.blocked, tile)) continue;
      tiles.push(tile);
    }
  }

  tiles.sort((a, b) => {
    const clickedA = a.x === goal.x && a.y === goal.y ? 0 : 1;
    const clickedB = b.x === goal.x && b.y === goal.y ? 0 : 1;
    if (clickedA !== clickedB) return clickedA - clickedB;
    const distance = manhattan(a, goal) - manhattan(b, goal);
    if (distance !== 0) return distance;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  return tiles.slice(0, STAGING_CANDIDATES);
}
