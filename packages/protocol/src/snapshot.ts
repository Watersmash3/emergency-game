import { z } from 'zod';

import { TICK_RATE_HZ } from './scenario.ts';
import { objectTypeSchema, teamDefinitionSchema, tileSchema, vec2Schema } from './scenario.ts';

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

const taskCommonSchema = {
  id: z.string().min(1),
  state: taskStateSchema,
  assigneeId: z.string().min(1),
  groupId: z.string().min(1).optional(),
  source: z.enum(['team', 'individual']),
  suspendedByTaskId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
};

export const taskSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    ...taskCommonSchema,
    kind: z.literal('move'),
    destination: tileSchema,
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('retrieve-equipment'),
    targetId: z.string().min(1),
    definitionId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('force-door'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('operate-panel'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('board-vehicle'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('exit-vehicle'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('drive-vehicle'),
    targetId: z.string().min(1),
    destinationNodeId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('respond'),
    targetId: z.string().min(1),
    destinationNodeId: z.string().min(1),
    disembark: z.boolean(),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('interact'),
    targetId: z.string().min(1),
    action: z.enum(['take', 'force', 'operate', 'board', 'exit']),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().positive(),
  }),
]);

export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;

export const carriedEquipmentSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  name: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
});

export type CarriedEquipment = z.infer<typeof carriedEquipmentSchema>;

export const entitySnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  teamId: z.string().min(1),
  position: vec2Schema,
  speed: z.number().positive(),
  activeTaskId: z.string().min(1).nullable(),
  path: z.array(vec2Schema),
  inventory: z.array(carriedEquipmentSchema),
  aboardVehicleId: z.string().min(1).optional(),
});

export type EntitySnapshot = z.infer<typeof entitySnapshotSchema>;

export const storedEquipmentSchema = carriedEquipmentSchema.extend({
  reserved: z.boolean(),
});

export type StoredEquipment = z.infer<typeof storedEquipmentSchema>;

export const objectSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objectType: objectTypeSchema,
  position: tileSchema,
  state: z.string().min(1),
  requiredCapability: z.string().min(1).optional(),
  interactionTiles: z.array(tileSchema),
  contents: z.array(storedEquipmentSchema),
});

export type ObjectSnapshot = z.infer<typeof objectSnapshotSchema>;

export const vehicleSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  definitionId: z.string().min(1),
  position: vec2Schema,
  heading: z.number(),
  footprint: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  capacity: z.number().int().positive(),
  occupants: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  driverId: z.string().min(1).nullable(),
  designatedDriverId: z.string().min(1),
  status: z.enum(['idle', 'boarding', 'moving']),
  nodeId: z.string().min(1),
  destinationNodeId: z.string().min(1).nullable(),
  speed: z.number().positive(),
  contents: z.array(storedEquipmentSchema),
});

export type VehicleSnapshot = z.infer<typeof vehicleSnapshotSchema>;

export const roadSnapshotSchema = z.object({
  id: z.string().min(1),
  position: tileSchema,
  kind: z.enum(['intersection', 'staging', 'spawn']),
});

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
  objects: z.array(objectSnapshotSchema),
  vehicles: z.array(vehicleSnapshotSchema),
  roads: z.array(roadSnapshotSchema),
  roadEdges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  inventoryCapacity: z.number().int().positive(),
  tasks: z.array(taskSnapshotSchema),
});

export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;
