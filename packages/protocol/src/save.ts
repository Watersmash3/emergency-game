import { z } from 'zod';

import { queuedCommandSchema } from './commands.ts';
import { objectTypeSchema, teamDefinitionSchema, tileSchema, vec2Schema } from './scenario.ts';
import { exposureSnapshotSchema, hazardCellSchema, taskStateSchema } from './snapshot.ts';

/** Version of the portable save document. Render snapshots are not save files. */
export const SAVE_SCHEMA_VERSION = 3;

const SUPPORTED_SAVE_VERSIONS = new Set([1, 2, SAVE_SCHEMA_VERSION]);

function waterSave<const K extends string>(kind: K) {
  return z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal(kind),
    equipmentId: z.string().min(1).optional(),
    vehicleId: z.string().min(1).optional(),
    hydrantId: z.string().min(1).optional(),
    hoseEntityId: z.string().min(1).optional(),
    destination: tileSchema.optional(),
    role: z.enum(['supply', 'pump', 'attack']).optional(),
  });
}

const saveTaskCommon = {
  id: z.string().min(1),
  state: taskStateSchema,
  assigneeId: z.string().min(1),
  groupId: z.string().min(1).optional(),
  source: z.enum(['team', 'individual']),
  suspendedByTaskId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
  reservations: z.array(z.string().min(1)),
};

const activityFields = {
  targetId: z.string().min(1),
  step: z.string().min(1),
  childTaskId: z.string().min(1).optional(),
  approachTile: tileSchema.optional(),
  progressTicks: z.number().int().nonnegative(),
  durationTicks: z.number().int().nonnegative(),
};

export const saveTaskSchema = z.discriminatedUnion('kind', [
  z.object({
    ...saveTaskCommon,
    kind: z.literal('move'),
    destination: tileSchema,
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('retrieve-equipment'),
    definitionId: z.string().min(1),
    equipmentId: z.string().min(1).optional(),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('force-door'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('operate-panel'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('board-vehicle'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('exit-vehicle'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('drive-vehicle'),
    destinationNodeId: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).min(1),
    pathIndex: z.number().int().nonnegative(),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('respond'),
    destinationNodeId: z.string().min(1),
    disembark: z.boolean(),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('suppress-fire'),
    equipmentId: z.string().min(1).optional(),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('suppress-incident'),
  }),
  waterSave('connect-supply'),
  waterSave('disconnect-supply'),
  waterSave('open-supply'),
  waterSave('close-supply'),
  waterSave('start-pump'),
  waterSave('stop-pump'),
  waterSave('deploy-attack'),
  waterSave('operate-nozzle'),
  waterSave('reposition-nozzle'),
  waterSave('disconnect-attack'),
  waterSave('establish-fire-attack'),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('open-door'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('close-door'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('search-room'),
    searchIndex: z.number().int().nonnegative(),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('search-building'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('ventilate'),
  }),
  z.object({
    ...saveTaskCommon,
    ...activityFields,
    kind: z.literal('overhaul'),
  }),
  z.object({
    ...saveTaskCommon,
    kind: z.literal('interact'),
    targetId: z.string().min(1),
    action: z.enum(['take', 'force', 'operate', 'board', 'exit']),
    step: z.literal('interact'),
    progressTicks: z.number().int().nonnegative(),
    durationTicks: z.number().int().positive(),
  }),
]);

export type SaveTask = z.infer<typeof saveTaskSchema>;

export const saveEntitySchema = z.object({
  id: z.string().min(1),
  position: vec2Schema.optional(),
  movement: z
    .object({
      speed: z.number().positive(),
      path: z.array(vec2Schema),
      destination: tileSchema.nullable(),
    })
    .optional(),
  responder: z
    .object({
      name: z.string().min(1),
      aboardVehicleId: z.string().min(1).optional(),
    })
    .optional(),
  teamMembership: z
    .object({
      teamId: z.string().min(1),
    })
    .optional(),
  interactable: z
    .object({
      name: z.string().min(1),
      objectType: objectTypeSchema,
      state: z.string().min(1),
      requiredCapability: z.string().min(1).optional(),
      interactionTiles: z.array(tileSchema),
    })
    .optional(),
  vehicle: z
    .object({
      definitionId: z.string().min(1),
      name: z.string().min(1),
      heading: z.number(),
      footprint: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
      capacity: z.number().int().positive(),
      occupants: z.array(z.string().min(1)),
      driverId: z.string().min(1).nullable(),
      designatedDriverId: z.string().min(1),
      status: z.enum(['idle', 'boarding', 'moving']),
      nodeId: z.string().min(1),
      destinationNodeId: z.string().min(1).nullable(),
      pump: z
        .object({
          state: z.enum(['off', 'starting', 'operating', 'unavailable']),
          pressure: z.number().nonnegative(),
          maxDelivery: z.number().positive(),
          tankCapacity: z.number().positive(),
          tank: z.number().nonnegative(),
          intakeId: z.string().min(1).nullable(),
          discharges: z.array(z.string().min(1)),
          delivered: z.number().nonnegative(),
        })
        .nullable(),
      seatReservations: z.array(
        z.object({
          responderId: z.string().min(1),
          taskId: z.string().min(1),
        }),
      ),
    })
    .optional(),
  fire: z
    .object({
      name: z.string().min(1),
      intensity: z.number().nonnegative(),
      maxIntensity: z.number().positive(),
      fuel: z.number().nonnegative(),
      growth: z.number().nonnegative(),
      fuelUse: z.number().nonnegative(),
      range: z.number().int().nonnegative(),
    })
    .optional(),
  hydrant: z
    .object({
      name: z.string().min(1),
      available: z.boolean(),
      flowCapacity: z.number().positive(),
      connectionId: z.string().min(1).nullable(),
      interactionTiles: z.array(tileSchema),
    })
    .optional(),
  hose: z
    .object({
      kind: z.enum(['supply', 'attack']),
      name: z.string().min(1),
      definitionId: z.string().min(1),
      equipmentId: z.string().min(1),
      maxLength: z.number().positive(),
      route: z.array(vec2Schema).min(1),
      state: z.enum(['connected', 'open']),
      sourceId: z.string().min(1).nullable(),
      targetId: z.string().min(1).nullable(),
      operatorId: z.string().min(1).nullable(),
      flow: z.number().nonnegative(),
    })
    .optional(),
});

export type SaveEntity = z.infer<typeof saveEntitySchema>;

export const saveDocumentSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  scenarioId: z.string().min(1),
  seed: z.number().int(),
  rngState: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  paused: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocked: z.array(tileSchema),
  inventoryCapacity: z.number().int().positive(),
  nextId: z.number().int().positive(),
  team: teamDefinitionSchema,
  catalog: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      capabilities: z.array(z.string().min(1)),
      agent: z.number().nonnegative().nullable(),
      suppression: z.number().nonnegative(),
      maxLength: z.number().positive().nullable().optional(),
    }),
  ),
  equipment: z.array(
    z.object({
      id: z.string().min(1),
      definitionId: z.string().min(1),
      ownerId: z.string().min(1).nullable(),
      locationId: z.string().min(1).nullable(),
      reservedByTaskId: z.string().min(1).nullable(),
      agent: z.number().nonnegative().nullable(),
    }),
  ),
  entities: z.array(saveEntitySchema),
  tasks: z.array(saveTaskSchema),
  incidents: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      state: z.enum(['active', 'resolved']),
    }),
  ),
  objectives: z.array(
    z.object({
      id: z.string().min(1),
      incidentId: z.string().min(1),
      kind: z.enum(['suppress-fire', 'overhaul-room']),
      targetId: z.string().min(1),
      state: z.enum(['open', 'satisfied']),
    }),
  ),
  roads: z.array(
    z.object({
      id: z.string().min(1),
      x: z.number().int(),
      y: z.number().int(),
      kind: z.enum(['intersection', 'staging', 'spawn']),
    }),
  ),
  roadEdges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  reservedNodes: z.array(
    z.object({
      nodeId: z.string().min(1),
      taskId: z.string().min(1),
    }),
  ),
  reservedExits: z.array(
    z.object({
      x: z.number().int(),
      y: z.number().int(),
      taskId: z.string().min(1),
    }),
  ),
  orders: z
    .array(
      z.object({
        id: z.string().min(1),
        command: queuedCommandSchema,
      }),
    )
    .default([]),
  notices: z
    .array(
      z.object({
        id: z.string().min(1),
        tick: z.number().int().nonnegative(),
        key: z.string().min(1),
        message: z.string().min(1),
        tone: z.enum(['info', 'warning', 'good']),
      }),
    )
    .default([]),
  buildings: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        floorId: z.string().min(1),
      }),
    )
    .default([]),
  floors: z
    .array(
      z.object({
        id: z.string().min(1),
        buildingId: z.string().min(1),
        name: z.string().min(1),
        entranceDoorId: z.string().min(1),
        entry: tileSchema,
        walls: z.array(tileSchema),
      }),
    )
    .default([]),
  rooms: z
    .array(
      z.object({
        id: z.string().min(1),
        buildingId: z.string().min(1),
        floorId: z.string().min(1),
        name: z.string().min(1),
        tiles: z.array(tileSchema),
        entrance: tileSchema,
        searchTiles: z.array(tileSchema),
        state: z.enum(['unsearched', 'searching', 'searched', 'blocked']),
        discovered: z.boolean(),
        assigneeId: z.string().min(1).nullable(),
        reservedByTaskId: z.string().min(1).nullable(),
        discoveries: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            position: tileSchema,
            found: z.boolean(),
          }),
        ),
        upperTemp: z.number().default(20),
        lowerTemp: z.number().default(20),
        smoke: z.number().nonnegative().default(0),
        oxygen: z.number().nonnegative().default(1),
        overhauled: z.boolean().default(false),
        flashed: z.boolean().default(false),
      }),
    )
    .default([]),
  reservedDoors: z
    .array(
      z.object({
        doorId: z.string().min(1),
        taskId: z.string().min(1),
      }),
    )
    .default([]),
  hazards: z.array(hazardCellSchema).default([]),
  exposure: z.array(exposureSnapshotSchema).default([]),
  furnishings: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        x: z.number().int(),
        y: z.number().int(),
        materialId: z.string().min(1),
      }),
    )
    .default([]),
  damage: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().int(),
        y: z.number().int(),
        integrity: z.number().nonnegative(),
        failed: z.boolean(),
      }),
    )
    .default([]),
});

export type SaveDocument = z.infer<typeof saveDocumentSchema>;

export function saveSchemaMessage(input: unknown): string {
  if (
    isRecord(input) &&
    'schemaVersion' in input &&
    !SUPPORTED_SAVE_VERSIONS.has(input.schemaVersion as number)
  ) {
    return `This save uses schema version ${String(input.schemaVersion)} and cannot be loaded.`;
  }
  return 'This save is invalid or incomplete.';
}

const MIGRATED_PUMP = {
  state: 'off',
  pressure: 0,
  maxDelivery: 1,
  tankCapacity: 80,
  tank: 80,
  intakeId: null,
  discharges: [],
  delivered: 0,
} as const;

/** Upgrade a version 1 or 2 document to the current schema. */
export function migrateSave(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (input.schemaVersion === 1) {
    const entities = Array.isArray(input.entities) ? input.entities.map(migrateEntity) : input.entities;
    return migrateSave({ ...input, schemaVersion: 2, entities });
  }
  if (input.schemaVersion === 2) return { ...input, schemaVersion: SAVE_SCHEMA_VERSION };
  return input;
}

export function prepareSaveDocument(
  input: unknown,
): { ok: true; document: SaveDocument } | { ok: false; message: string } {
  const parsed = saveDocumentSchema.safeParse(migrateSave(input));
  if (!parsed.success) return { ok: false, message: saveSchemaMessage(input) };
  return { ok: true, document: parsed.data };
}

function migrateEntity(entity: unknown): unknown {
  if (!isRecord(entity) || !isRecord(entity.vehicle) || 'pump' in entity.vehicle) return entity;
  return { ...entity, vehicle: { ...entity.vehicle, pump: MIGRATED_PUMP } };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
