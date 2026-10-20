import type { TeamDefinition } from '@emergency/protocol';

import type { EquipmentDefinitionRecord, EquipmentInstance } from '../components/equipment.ts';
import type { Rng } from '../core/rng.ts';
import type { Entity } from '../entities/Entity.ts';
import type { IncidentRecord, ObjectiveRecord } from '../components/incident.ts';
import type { RoadNode } from '../navigation/road.ts';
import type { BuildingRecord, DoorLink, FloorRecord, RoomRecord } from '../components/building.ts';
import type { Notice } from '../tasks/notices.ts';
import type { QueuedOrder } from '../tasks/orders.ts';
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
  orders: QueuedOrder[];
  notices: Notice[];
  statusStamp: Map<string, string>;
  noticeLatch: Set<string>;
  buildings: Map<string, BuildingRecord>;
  floors: Map<string, FloorRecord>;
  rooms: Map<string, RoomRecord>;
  doorLinks: Map<string, DoorLink>;
  reservedDoors: Map<string, string>;
  routeEpoch: number;
  equipment: Map<string, EquipmentInstance>;
  catalog: Map<string, EquipmentDefinitionRecord>;
  inventoryCapacity: number;
  team: TeamDefinition;
  roadNodes: Map<string, RoadNode>;
  adjacency: Map<string, string[]>;
  roadEdges: { from: string; to: string }[];
  reservedNodes: Map<string, string>;
  reservedExits: Map<string, string>;
  incidents: Map<string, IncidentRecord>;
  objectives: Map<string, ObjectiveRecord>;
  tick: number;
  paused: boolean;
  accumulatorMs: number;
  nextId: number;
}

export const MAX_TICKS_PER_STEP = 8;
