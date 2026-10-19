import { z } from 'zod';

/** Simulation ticks per second. Movement and AI advance only on these steps. */
export const TICK_RATE_HZ = 20;

/** Fixed simulation step, in milliseconds. */
export const FIXED_DT_MS = 1000 / TICK_RATE_HZ;

export const vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});

export type Vec2 = z.infer<typeof vec2Schema>;

export const tileSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export type Tile = z.infer<typeof tileSchema>;

export const responderDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: tileSchema,
  speed: z.number().positive(),
});

export type ResponderDefinition = z.infer<typeof responderDefinitionSchema>;

export const teamDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1),
});

export type TeamDefinition = z.infer<typeof teamDefinitionSchema>;

export const objectTypeSchema = z.enum(['locker', 'door', 'panel']);

export type ObjectType = z.infer<typeof objectTypeSchema>;

export const worldObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objectType: objectTypeSchema,
  position: tileSchema,
  state: z.string().min(1),
  requiredCapability: z.string().min(1).optional(),
});

export type WorldObjectDefinition = z.infer<typeof worldObjectSchema>;

export const equipmentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
});

export type EquipmentDefinition = z.infer<typeof equipmentDefinitionSchema>;

export const equipmentPlacementSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  locationId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
});

export type EquipmentPlacement = z.infer<typeof equipmentPlacementSchema>;

export const scenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seed: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blocked: z.array(tileSchema),
  team: teamDefinitionSchema,
  responders: z.array(responderDefinitionSchema).min(1),
  objects: z.array(worldObjectSchema).default([]),
  equipmentCatalog: z.array(equipmentDefinitionSchema).default([]),
  equipment: z.array(equipmentPlacementSchema).default([]),
  inventoryCapacity: z.number().int().positive().default(2),
});

export type Scenario = z.infer<typeof scenarioSchema>;
