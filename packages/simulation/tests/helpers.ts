import { scenarioSchema, type Scenario, type Tile } from '@emergency/protocol';

import { createSimulation, type Simulation } from '../src/index.ts';

export function makeScenario(
  input: {
    width?: number;
    height?: number;
    blocked?: Tile[];
    responders?: Scenario['responders'];
    memberIds?: string[];
    speed?: number;
    objects?: Scenario['objects'];
    equipmentCatalog?: Scenario['equipmentCatalog'];
    equipment?: Scenario['equipment'];
    inventoryCapacity?: number;
    apparatusId?: string;
    roadNodes?: Scenario['roadNodes'];
    roadEdges?: Scenario['roadEdges'];
    vehicleCatalog?: Scenario['vehicleCatalog'];
    vehicles?: Scenario['vehicles'];
  } = {},
): Scenario {
  const responders = input.responders ?? [
    { id: 'a', name: 'A', position: { x: 0, y: 0 }, speed: input.speed ?? 4 },
    { id: 'b', name: 'B', position: { x: 1, y: 0 }, speed: input.speed ?? 4 },
  ];

  return scenarioSchema.parse({
    id: 'test',
    name: 'Test yard',
    seed: 7,
    width: input.width ?? 12,
    height: input.height ?? 12,
    blocked: input.blocked ?? [],
    team: {
      id: 'engine-1',
      name: 'Engine 1',
      memberIds: input.memberIds ?? responders.map((responder) => responder.id),
      ...(input.apparatusId ? { apparatusId: input.apparatusId } : {}),
    },
    responders,
    ...(input.objects ? { objects: input.objects } : {}),
    ...(input.equipmentCatalog ? { equipmentCatalog: input.equipmentCatalog } : {}),
    ...(input.equipment ? { equipment: input.equipment } : {}),
    ...(input.inventoryCapacity ? { inventoryCapacity: input.inventoryCapacity } : {}),
    ...(input.roadNodes ? { roadNodes: input.roadNodes } : {}),
    ...(input.roadEdges ? { roadEdges: input.roadEdges } : {}),
    ...(input.vehicleCatalog ? { vehicleCatalog: input.vehicleCatalog } : {}),
    ...(input.vehicles ? { vehicles: input.vehicles } : {}),
  });
}

export function simulation(input: Parameters<typeof makeScenario>[0] = {}): Simulation {
  return createSimulation(makeScenario(input));
}

export function entityAt(sim: Simulation, id: string) {
  const entity = sim.getSnapshot().entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`Missing entity ${id}`);
  return entity;
}

export function tasksFor(sim: Simulation, id: string) {
  return sim.getSnapshot().tasks.filter((task) => task.assigneeId === id);
}
