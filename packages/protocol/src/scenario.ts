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
  apparatusId: z.string().min(1).optional(),
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

export const roadNodeSchema = z.object({
  id: z.string().min(1),
  position: tileSchema,
  kind: z.enum(['intersection', 'staging', 'spawn']),
});

export type RoadNodeDefinition = z.infer<typeof roadNodeSchema>;

export const roadEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export type RoadEdgeDefinition = z.infer<typeof roadEdgeSchema>;

export const vehicleCatalogSchema = z.object({
  id: z.string().min(1),
  capacity: z.number().int().positive(),
  speed: z.number().positive(),
  footprint: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export type VehicleCatalogDefinition = z.infer<typeof vehicleCatalogSchema>;

export const vehiclePlacementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  definitionId: z.string().min(1),
  nodeId: z.string().min(1),
  heading: z.number().default(0),
});

export type VehiclePlacement = z.infer<typeof vehiclePlacementSchema>;

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
  roadNodes: z.array(roadNodeSchema).default([]),
  roadEdges: z.array(roadEdgeSchema).default([]),
  vehicleCatalog: z.array(vehicleCatalogSchema).default([]),
  vehicles: z.array(vehiclePlacementSchema).default([]),
});

export type Scenario = z.infer<typeof scenarioSchema>;
