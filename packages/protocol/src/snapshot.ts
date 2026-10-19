import { z } from 'zod';

import { TICK_RATE_HZ } from './scenario.ts';
import { teamDefinitionSchema, tileSchema, vec2Schema } from './scenario.ts';

export const taskStateSchema = z.enum([
  'pending',
  'ready',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
]);

export type TaskState = z.infer<typeof taskStateSchema>;

export const taskSnapshotSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('move'),
  state: taskStateSchema,
  assigneeId: z.string().min(1),
  groupId: z.string().min(1).optional(),
  source: z.enum(['team', 'individual']),
  destination: tileSchema,
  suspendedByTaskId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
});

export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;

export const entitySnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  teamId: z.string().min(1),
  position: vec2Schema,
  speed: z.number().positive(),
  activeTaskId: z.string().min(1).nullable(),
  path: z.array(vec2Schema),
});

export type EntitySnapshot = z.infer<typeof entitySnapshotSchema>;

export const simulationSnapshotSchema = z.object({
  scenarioId: z.string().min(1),
  seed: z.number().int(),
  rngState: z.number().int(),
  tick: z.number().int().nonnegative(),
  paused: z.boolean(),
  tickRate: z.literal(TICK_RATE_HZ),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocked: z.array(tileSchema),
  team: teamDefinitionSchema,
  entities: z.array(entitySnapshotSchema),
  tasks: z.array(taskSnapshotSchema),
});

export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;
