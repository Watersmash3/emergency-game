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

function waterSnapshot<const K extends string>(kind: K) {
  return z.object({
    ...taskCommonSchema,
    kind: z.literal(kind),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
    equipmentId: z.string().min(1).optional(),
    vehicleId: z.string().min(1).optional(),
    hydrantId: z.string().min(1).optional(),
    hoseId: z.string().min(1).optional(),
    destination: tileSchema.optional(),
    role: z.enum(['supply', 'pump', 'attack']).optional(),
  });
}

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
    kind: z.literal('suppress-fire'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('suppress-incident'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  waterSnapshot('connect-supply'),
  waterSnapshot('disconnect-supply'),
  waterSnapshot('open-supply'),
  waterSnapshot('close-supply'),
  waterSnapshot('start-pump'),
  waterSnapshot('stop-pump'),
  waterSnapshot('deploy-attack'),
  waterSnapshot('operate-nozzle'),
  waterSnapshot('reposition-nozzle'),
  waterSnapshot('disconnect-attack'),
  waterSnapshot('establish-fire-attack'),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('open-door'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('close-door'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('search-room'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    searchIndex: z.number().int().nonnegative(),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('search-building'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('ventilate'),
    targetId: z.string().min(1),
    step: z.string().min(1),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().nonnegative(),
  }),
  z.object({
    ...taskCommonSchema,
    kind: z.literal('overhaul'),
    targetId: z.string().min(1),
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
  agent: z.number().nonnegative().optional(),
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
  pump: z
    .object({
      state: z.enum(['off', 'starting', 'operating', 'unavailable']),
      pressure: z.number().nonnegative(),
      maxDelivery: z.number().positive(),
      tank: z.number().nonnegative(),
      tankCapacity: z.number().positive(),
      intakeId: z.string().min(1).nullable(),
      discharges: z.array(z.string().min(1)),
    })
    .optional(),
});

export type VehicleSnapshot = z.infer<typeof vehicleSnapshotSchema>;

export const fireSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: tileSchema,
  intensity: z.number().nonnegative(),
  maxIntensity: z.number().positive(),
  fuel: z.number().nonnegative(),
  out: z.boolean(),
});

export type FireSnapshot = z.infer<typeof fireSnapshotSchema>;

export const hazardCellSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  temperature: z.number(),
  fuel: z.number().nonnegative(),
  combustion: z.number().nonnegative(),
  smoke: z.number().nonnegative(),
  water: z.number().nonnegative(),
  sourceId: z.string().min(1),
  materialId: z.string().min(1).default('wood'),
  char: z.number().nonnegative().default(0),
  steam: z.number().nonnegative().default(0),
  hotspot: z.boolean().default(false),
  revealed: z.boolean().default(false),
});

export type HazardCellSnapshot = z.infer<typeof hazardCellSchema>;

export const exposureSnapshotSchema = z.object({
  responderId: z.string().min(1),
  exposure: z.number().nonnegative(),
  air: z.number().nonnegative().nullable(),
});

export type ExposureSnapshot = z.infer<typeof exposureSnapshotSchema>;

export const incidentSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(['active', 'resolved']),
  objectives: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['suppress-fire', 'overhaul-room']),
      targetId: z.string().min(1),
      state: z.enum(['open', 'satisfied']),
    }),
  ),
  phase: z.enum(['developing', 'contained', 'knockdown', 'resolved']).default('developing'),
  trend: z.enum(['growing', 'steady', 'dying']).default('steady'),
});

export type IncidentSnapshot = z.infer<typeof incidentSnapshotSchema>;

export const roadSnapshotSchema = z.object({
  id: z.string().min(1),
  position: tileSchema,
  kind: z.enum(['intersection', 'staging', 'spawn']),
});

export const hydrantSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: tileSchema,
  available: z.boolean(),
  flowCapacity: z.number().positive(),
  connectionId: z.string().min(1).nullable(),
});

export type HydrantSnapshot = z.infer<typeof hydrantSnapshotSchema>;

export const hoseSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['supply', 'attack']),
  state: z.enum(['connected', 'open']),
  sourceId: z.string().min(1).nullable(),
  targetId: z.string().min(1).nullable(),
  operatorId: z.string().min(1).nullable(),
  length: z.number().nonnegative(),
  maxLength: z.number().positive(),
  flow: z.number().nonnegative(),
  route: z.array(vec2Schema),
});

export type HoseSnapshot = z.infer<typeof hoseSnapshotSchema>;

export const orderSnapshotSchema = z.object({
  id: z.string().min(1),
  assigneeId: z.string().min(1),
  label: z.string().min(1),
  destination: tileSchema.nullable(),
});

export type OrderSnapshot = z.infer<typeof orderSnapshotSchema>;

export const noticeSnapshotSchema = z.object({
  id: z.string().min(1),
  tick: z.number().int().nonnegative(),
  message: z.string().min(1),
  tone: z.enum(['info', 'warning', 'good']),
});

export type NoticeSnapshot = z.infer<typeof noticeSnapshotSchema>;

export const roomSnapshotSchema = z.object({
  id: z.string().min(1),
  buildingId: z.string().min(1),
  floorId: z.string().min(1),
  name: z.string().min(1),
  tiles: z.array(tileSchema),
  entrance: tileSchema,
  state: z.enum(['unsearched', 'searching', 'searched', 'blocked']),
  discovered: z.boolean(),
  assigneeId: z.string().min(1).nullable(),
  discoveries: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      found: z.boolean(),
    }),
  ),
  upperTemp: z.number().default(20),
  lowerTemp: z.number().default(20),
  smoke: z.number().nonnegative().default(0),
  oxygen: z.number().nonnegative().default(1),
  overhauled: z.boolean().default(false),
});

export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const buildingSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  floorId: z.string().min(1),
  entry: tileSchema,
  entranceDoorId: z.string().min(1),
  rooms: z.array(z.string().min(1)),
});

export type BuildingSnapshot = z.infer<typeof buildingSnapshotSchema>;

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
  fires: z.array(fireSnapshotSchema),
  hydrants: z.array(hydrantSnapshotSchema),
  hoses: z.array(hoseSnapshotSchema),
  incidents: z.array(incidentSnapshotSchema),
  orders: z.array(orderSnapshotSchema),
  notices: z.array(noticeSnapshotSchema),
  buildings: z.array(buildingSnapshotSchema),
  rooms: z.array(roomSnapshotSchema),
  hazards: z.array(hazardCellSchema).default([]),
  exposure: z.array(exposureSnapshotSchema).default([]),
  furnishings: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        position: tileSchema,
        materialId: z.string().min(1),
      }),
    )
    .default([]),
  damage: z
    .array(
      z.object({
        x: z.number().int(),
        y: z.number().int(),
        integrity: z.number().nonnegative(),
        failed: z.boolean(),
      }),
    )
    .default([]),
});

export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;
