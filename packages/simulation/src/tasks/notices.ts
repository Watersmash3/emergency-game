import type { World } from '../core/world.ts';
import type { Task } from './types.ts';

export type NoticeTone = 'info' | 'warning' | 'good';

export interface Notice {
  id: string;
  tick: number;
  key: string;
  message: string;
  tone: NoticeTone;
}

const MAX_NOTICES = 8;

export function seedStatus(world: World): void {
  world.statusStamp = stamp(world);
  world.noticeLatch = new Set(world.notices.map((notice) => notice.key));
}

export function scanStatus(world: World): void {
  const next = stamp(world);
  for (const [key, value] of next) {
    const previous = world.statusStamp.get(key);
    if (previous === value) continue;
    if (key.startsWith('vehicle:') && value.startsWith('idle:') && previous?.startsWith('moving:')) {
      const id = key.slice('vehicle:'.length);
      const entity = world.entities.get(id);
      const nodeId = value.slice('idle:'.length);
      const node = world.roadNodes.get(nodeId);
      const where = node?.kind === 'staging' ? ' at staging' : '';
      emitNotice(world, `arrived:${id}:${nodeId}`, `${entity?.vehicle?.name ?? id} arrived${where}.`, 'info');
    }
    if (key.startsWith('pump:') && value === 'operating') {
      emitNotice(world, key, 'Pump operating.', 'info');
    }
    if (key.startsWith('pump:') && value === 'unavailable') {
      emitNotice(world, `${key}:dry`, 'No water available.', 'warning');
    }
    if (key.startsWith('fire:') && value === 'out') {
      const id = key.slice('fire:'.length);
      const name = world.entities.get(id)?.fire?.name ?? id;
      emitNotice(world, key, `${name} extinguished.`, 'good');
    }
  }
  for (const [key, value] of world.statusStamp) {
    if (!key.startsWith('pump:') || value !== 'operating') continue;
    if (next.get(key) !== 'operating') world.noticeLatch.delete(key);
  }
  for (const [key, value] of world.statusStamp) {
    if (!key.startsWith('pump:') || value !== 'unavailable') continue;
    if (next.get(key) !== 'unavailable') world.noticeLatch.delete(`${key}:dry`);
  }
  world.statusStamp = next;
}

export function noteTaskFailure(world: World, task: Task, reason: string): void {
  if (task.parentId) return;
  const name = person(world, task.assigneeId);
  const message =
    reason === 'No path to destination' ||
    reason === 'Destination is blocked' ||
    reason === 'Destination is out of bounds'
      ? `${name} cannot reach the assigned position.`
      : reason === 'No suppression equipment' || reason === 'Suppression agent exhausted'
        ? `${name} has no water available.`
        : `${name} could not complete the order.`;
  emitNotice(world, `fail:${task.id}`, message, 'warning');
}

export function noteTaskComplete(world: World, task: Task): void {
  if (task.parentId) return;
  const name = person(world, task.assigneeId);
  const message =
    task.kind === 'connect-supply'
      ? `${name} connected the supply line.`
      : task.kind === 'deploy-attack'
        ? `${name} deployed the attack line.`
        : task.kind === 'open-supply'
          ? `${name} opened the supply valve.`
          : task.kind === 'board-vehicle'
            ? `${name} boarded.`
            : task.kind === 'exit-vehicle'
              ? `${name} left the apparatus.`
              : null;
  if (message) emitNotice(world, `done:${task.id}`, message, 'info');
}

export function noteUnreachable(world: World, assigneeId: string, taskId: string): void {
  emitNotice(
    world,
    `reach:${taskId}`,
    `${person(world, assigneeId)} cannot reach the assigned position.`,
    'warning',
  );
}

export function noteOrderRejected(world: World, orderId: string, assigneeId: string, reason: string): void {
  const unreachable =
    reason === 'No path to destination' ||
    reason === 'Destination is blocked' ||
    reason === 'Destination is out of bounds';
  emitNotice(
    world,
    `order:${orderId}`,
    unreachable
      ? `${person(world, assigneeId)} cannot reach the assigned position.`
      : `${person(world, assigneeId)} could not start the queued order.`,
    'warning',
  );
}

export function noteRoomSearched(world: World, responderId: string, roomName: string, found: string[]): void {
  const who = person(world, responderId);
  const detail = found.length > 0 ? ` Found ${found.join(', ')}.` : '';
  emitNotice(world, `search:${roomName}`, `${who} searched ${roomName}.${detail}`, 'good');
}

export function noteBuildingBlocked(world: World, buildingId: string): void {
  const building = world.buildings.get(buildingId);
  emitNotice(
    world,
    `building-blocked:${buildingId}`,
    `${building?.name ?? 'Building'} has rooms that cannot be reached.`,
    'warning',
  );
}

function person(world: World, id: string): string {
  const entity = world.entities.get(id);
  return entity?.responder?.name ?? entity?.vehicle?.name ?? id;
}

function emitNotice(world: World, key: string, message: string, tone: NoticeTone): void {
  if (world.noticeLatch.has(key)) return;
  world.noticeLatch.add(key);
  world.notices.push({
    id: `notice-${world.nextId}`,
    tick: world.tick,
    key,
    message,
    tone,
  });
  world.nextId += 1;
  while (world.notices.length > MAX_NOTICES) world.notices.shift();
}

function stamp(world: World): Map<string, string> {
  const next = new Map<string, string>();
  for (const entity of world.entities.values()) {
    if (entity.vehicle) {
      next.set(`vehicle:${entity.id}`, `${entity.vehicle.status}:${entity.vehicle.nodeId}`);
      if (entity.vehicle.pump) next.set(`pump:${entity.id}`, entity.vehicle.pump.state);
    }
    if (entity.fire) {
      next.set(`fire:${entity.id}`, entity.fire.fuel <= 0 ? 'out' : 'burning');
    }
  }
  return next;
}
