import type { QueuedCommand } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { nextIdentifier, isOpen } from './lifecycle.ts';
import { CommandRejection, type CommandResult } from './results.ts';

export interface QueuedOrder {
  id: string;
  command: QueuedCommand;
}

let promoting = false;

export function isPromoting(): boolean {
  return promoting;
}

export function setPromoting(value: boolean): void {
  promoting = value;
}

export function enqueueOrder(world: World, command: QueuedCommand): CommandResult {
  const entity = world.entities.get(command.responderId);
  if (!entity?.responder) return { ok: false, reason: CommandRejection.UnknownResponder };
  world.orders.push({ id: nextIdentifier(world, 'order'), command });
  return { ok: true };
}

export function cancelOrder(world: World, orderId: string): CommandResult {
  const order = world.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { ok: false, reason: CommandRejection.UnknownTask };
  world.orders = world.orders.filter((candidate) => candidate.id !== orderId);
  return { ok: true };
}

export function clearOrders(world: World, assigneeIds: readonly string[]): void {
  if (assigneeIds.length === 0) return;
  const ids = new Set(assigneeIds);
  world.orders = world.orders.filter((order) => !ids.has(order.command.responderId));
}

export function takeNextOrder(world: World, assigneeId: string): QueuedOrder | undefined {
  const order = world.orders.find((candidate) => candidate.command.responderId === assigneeId);
  if (!order) return undefined;
  world.orders = world.orders.filter((candidate) => candidate.id !== order.id);
  return order;
}

export function responderBusy(world: World, assigneeId: string): boolean {
  for (const task of world.tasks.values()) {
    if (task.assigneeId !== assigneeId) continue;
    if (task.state === 'running' || task.state === 'pending' || task.state === 'ready') return true;
    if (isOpen(task.state) && task.state !== 'suspended') return true;
  }
  return false;
}

export function orderLabel(command: QueuedCommand): string {
  switch (command.type) {
    case 'move-responder':
      return 'Move';
    case 'retrieve-equipment':
      return 'Retrieve equipment';
    case 'force-door':
      return 'Force door';
    case 'operate-panel':
      return 'Operate panel';
    case 'board-vehicle':
      return 'Board';
    case 'exit-vehicle':
      return 'Exit';
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}
