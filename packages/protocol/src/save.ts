import { z } from 'zod';

import { objectTypeSchema, teamDefinitionSchema, tileSchema, vec2Schema } from './scenario.ts';
import { taskStateSchema } from './snapshot.ts';

/** Version of the portable save document. Render snapshots are not save files. */
export const SAVE_SCHEMA_VERSION = 1;

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
      kind: z.literal('suppress-fire'),
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
});

export type SaveDocument = z.infer<typeof saveDocumentSchema>;

export function saveSchemaMessage(input: unknown): string {
  if (isRecord(input) && 'schemaVersion' in input && input.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return `This save uses schema version ${String(input.schemaVersion)} and cannot be loaded.`;
  }
  return 'This save is invalid or incomplete.';
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
