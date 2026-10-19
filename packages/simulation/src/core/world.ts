import type { TeamDefinition } from '@emergency/protocol';

import type { EquipmentDefinitionRecord, EquipmentInstance } from '../components/equipment.ts';
import type { Rng } from '../core/rng.ts';
import type { Entity } from '../entities/Entity.ts';
import type { Task } from '../tasks/types.ts';

export interface World {
  scenarioId: string;
  seed: number;
  rng: Rng;
  width: number;
  height: number;
  blocked: Set<string>;
  entities: Map<string, Entity>;
  tasks: Map<string, Task>;
  equipment: Map<string, EquipmentInstance>;
  catalog: Map<string, EquipmentDefinitionRecord>;
  inventoryCapacity: number;
  team: TeamDefinition;
  tick: number;
  paused: boolean;
  accumulatorMs: number;
  nextId: number;
}

export const MAX_TICKS_PER_STEP = 8;
