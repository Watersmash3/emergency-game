import type { TeamDefinition } from '@emergency/protocol';

import type { Rng } from '../core/rng.ts';
import type { Entity } from '../entities/Entity.ts';
import type { MoveTask } from '../tasks/MoveTask.ts';

export interface World {
  scenarioId: string;
  seed: number;
  rng: Rng;
  width: number;
  height: number;
  blocked: Set<string>;
  entities: Map<string, Entity>;
  tasks: Map<string, MoveTask>;
  team: TeamDefinition;
  tick: number;
  paused: boolean;
  accumulatorMs: number;
  nextId: number;
}

export const MAX_TICKS_PER_STEP = 8;
