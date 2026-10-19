import { FIXED_DT_MS } from '@emergency/protocol';
import type { Tile, Vec2 } from '@emergency/protocol';

import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { sameTile, tileCenter, tileOf } from '../navigation/grid.ts';
import type { MoveTask } from '../tasks/MoveTask.ts';
import { transition } from '../tasks/transitions.ts';
import type { World } from '../core/world.ts';

const ARRIVAL_DISTANCE = 0.001;

export function stepMovement(world: World): void {
  const completed: string[] = [];
  const entities = [...world.entities.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  for (const entity of entities) {
    const task = runningMoveTask(world, entity.id);
    if (!entity.position || !entity.movement || !task) {
      if (entity.movement) {
        entity.movement.path = [];
        entity.movement.destination = null;
      }
      continue;
    }

    ensurePath(world, entity, task);
    if (task.state !== 'running' || !entity.movement.destination) continue;

    if (hasArrived(entity.position, entity.movement.destination, entity.movement.path)) {
      finishMove(world, entity, task, completed);
      continue;
    }

    advance(entity, (entity.movement.speed * FIXED_DT_MS) / 1000);

    if (hasArrived(entity.position, entity.movement.destination, entity.movement.path)) {
      finishMove(world, entity, task, completed);
    }
  }

  for (const taskId of completed) {
    resumeSuspendedBy(world, taskId);
  }
}

export function runningMoveTask(world: World, assigneeId: string): MoveTask | undefined {
  const running = [...world.tasks.values()].filter(
    (task) => task.assigneeId === assigneeId && task.kind === 'move' && task.state === 'running',
  );
  running.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'individual' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return running[0];
}

function ensurePath(world: World, entity: Entity, task: MoveTask): void {
  if (!entity.position || !entity.movement) return;
  if (entity.movement.destination && sameTile(entity.movement.destination, task.destination))
    return;

  const path = findPath(world, tileOf(entity.position), task.destination);
  if (!path) {
    transition(task, 'failed');
    task.failureReason = 'No path to destination';
    entity.movement.path = [];
    entity.movement.destination = null;
    return;
  }

  entity.movement.destination = { ...task.destination };
  entity.movement.path = toWaypoints(path, entity.position);
}

function toWaypoints(tiles: Tile[], position: Vec2): Vec2[] {
  const points = tiles.map((tile) => tileCenter(tile));
  const first = points[0];
  if (first && distance(first, position) < ARRIVAL_DISTANCE) points.shift();
  return points;
}

function advance(entity: Entity, distanceBudget: number): void {
  if (!entity.position || !entity.movement) return;
  let remaining = distanceBudget;
  while (remaining > 0 && entity.movement.path.length > 0) {
    const next = entity.movement.path[0];
    if (!next) break;
    const step = distance(entity.position, next);
    if (step <= remaining || step < ARRIVAL_DISTANCE) {
      entity.position.x = next.x;
      entity.position.y = next.y;
      remaining -= step;
      entity.movement.path.shift();
    } else {
      entity.position.x += ((next.x - entity.position.x) / step) * remaining;
      entity.position.y += ((next.y - entity.position.y) / step) * remaining;
      remaining = 0;
    }
  }
}

function hasArrived(position: Vec2, destination: Tile, path: Vec2[]): boolean {
  return path.length === 0 && distance(position, tileCenter(destination)) < ARRIVAL_DISTANCE;
}

function finishMove(world: World, entity: Entity, task: MoveTask, completed: string[]): void {
  transition(task, 'completed');
  if (entity.movement) entity.movement.path = [];
  completed.push(task.id);
}

function resumeSuspendedBy(world: World, completedTaskId: string): void {
  for (const task of world.tasks.values()) {
    if (task.state !== 'suspended' || task.suspendedByTaskId !== completedTaskId) continue;
    transition(task, 'running');
    task.suspendedByTaskId = undefined;
    const entity = world.entities.get(task.assigneeId);
    if (!entity?.movement) continue;
    entity.movement.path = [];
    entity.movement.destination = null;
  }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
