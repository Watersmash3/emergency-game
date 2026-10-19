import {
  FIXED_DT_MS,
  TICK_RATE_HZ,
  scenarioSchema,
  type Command,
  type Scenario,
  type SimulationSnapshot,
  type TaskSnapshot,
} from '@emergency/protocol';

import { createRng } from './rng.ts';
import { MAX_TICKS_PER_STEP, type World } from './world.ts';
import type { Entity } from '../entities/Entity.ts';
import { inBounds, isBlocked, tileCenter, tileKey } from '../navigation/grid.ts';
import { runningMoveTask, stepMovement } from '../systems/movementSystem.ts';
import { applyCommand, type CommandResult } from '../tasks/moveTasks.ts';

export class Simulation {
  private readonly world: World;

  constructor(scenarioInput: Scenario) {
    this.world = createWorld(scenarioInput);
  }

  apply(command: Command): CommandResult {
    return applyCommand(this.world, command);
  }

  /** Advance one fixed step. A paused simulation does not move or increment time. */
  tick(): void {
    if (this.world.paused) return;
    this.world.tick += 1;
    stepMovement(this.world);
  }

  /** Catch up by whole fixed steps. Partial time is kept until the next call. */
  step(dtMs: number): number {
    if (this.world.paused || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
    this.world.accumulatorMs += dtMs;
    let ticks = 0;
    while (this.world.accumulatorMs >= FIXED_DT_MS && ticks < MAX_TICKS_PER_STEP) {
      this.tick();
      this.world.accumulatorMs -= FIXED_DT_MS;
      ticks += 1;
    }
    return ticks;
  }

  getSnapshot(): SimulationSnapshot {
    return snapshotOf(this.world);
  }
}

export function createSimulation(scenario: Scenario): Simulation {
  return new Simulation(scenario);
}

function createWorld(scenarioInput: Scenario): World {
  const scenario = scenarioSchema.parse(scenarioInput);
  const responderIds = new Set<string>();
  for (const responder of scenario.responders) {
    if (responderIds.has(responder.id)) {
      throw new Error(`Duplicate responder id ${responder.id}`);
    }
    responderIds.add(responder.id);
  }

  for (const memberId of scenario.team.memberIds) {
    if (!responderIds.has(memberId)) {
      throw new Error(`Team member ${memberId} has no responder`);
    }
  }

  const blocked = new Set<string>();
  for (const tile of scenario.blocked) {
    if (!inBounds(scenario.width, scenario.height, tile)) {
      throw new Error(`Blocked tile ${tile.x},${tile.y} is outside the map`);
    }
    blocked.add(tileKey(tile));
  }

  const entities = new Map<string, Entity>();
  for (const responder of scenario.responders) {
    if (isBlocked(blocked, responder.position)) {
      throw new Error(`Responder ${responder.id} spawns on a blocked tile`);
    }
    if (!inBounds(scenario.width, scenario.height, responder.position)) {
      throw new Error(`Responder ${responder.id} spawns outside the map`);
    }
    const center = tileCenter(responder.position);
    entities.set(responder.id, {
      id: responder.id,
      position: { x: center.x, y: center.y },
      movement: { speed: responder.speed, path: [], destination: null },
      responder: { name: responder.name },
      teamMembership: { teamId: scenario.team.id },
    });
  }

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    rng: createRng(scenario.seed),
    width: scenario.width,
    height: scenario.height,
    blocked,
    entities,
    tasks: new Map(),
    team: {
      id: scenario.team.id,
      name: scenario.team.name,
      memberIds: [...scenario.team.memberIds],
    },
    tick: 0,
    paused: false,
    accumulatorMs: 0,
    nextId: 1,
  };
}

function snapshotOf(world: World): SimulationSnapshot {
  const entities = [...world.entities.values()]
    .filter(
      (entity) => entity.position && entity.movement && entity.responder && entity.teamMembership,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entity) => {
      const position = entity.position;
      const movement = entity.movement;
      const responder = entity.responder;
      const membership = entity.teamMembership;
      if (!position || !movement || !responder || !membership) {
        throw new Error(`Entity ${entity.id} is missing a required component`);
      }
      return {
        id: entity.id,
        name: responder.name,
        teamId: membership.teamId,
        position: { x: position.x, y: position.y },
        speed: movement.speed,
        activeTaskId: runningMoveTask(world, entity.id)?.id ?? null,
        path: movement.path.map((point) => ({ x: point.x, y: point.y })),
      };
    });

  const tasks = [...world.tasks.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((task) => {
      const snapshot: TaskSnapshot = {
        id: task.id,
        kind: 'move',
        state: task.state,
        assigneeId: task.assigneeId,
        source: task.source,
        destination: { x: task.destination.x, y: task.destination.y },
      };
      if (task.groupId) snapshot.groupId = task.groupId;
      if (task.suspendedByTaskId) snapshot.suspendedByTaskId = task.suspendedByTaskId;
      if (task.failureReason) snapshot.failureReason = task.failureReason;
      return snapshot;
    });

  const blocked = [...world.blocked]
    .map((key) => {
      const [xText, yText] = key.split(',');
      return { x: Number(xText), y: Number(yText) };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    scenarioId: world.scenarioId,
    seed: world.seed,
    rngState: world.rng.getState(),
    tick: world.tick,
    paused: world.paused,
    tickRate: TICK_RATE_HZ,
    width: world.width,
    height: world.height,
    blocked,
    team: {
      id: world.team.id,
      name: world.team.name,
      memberIds: [...world.team.memberIds],
    },
    entities,
    tasks,
  };
}
