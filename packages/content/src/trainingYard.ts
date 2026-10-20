import { scenarioSchema, type Scenario, type Tile } from '@emergency/protocol';

const STRUCTURE_ORIGIN = { x: 8, y: 8 };
const STRUCTURE_SIZE = 5;

function sidewalk(): Tile[] {
  const tiles: Tile[] = [];
  for (let x = 4; x <= 16; x += 1) tiles.push({ x, y: 13 });
  for (let y = 2; y <= 13; y += 1) tiles.push({ x: 4, y });
  for (let y = 9; y <= 12; y += 1) tiles.push({ x: 16, y });
  return tiles;
}

function structureTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let y = STRUCTURE_ORIGIN.y; y < STRUCTURE_ORIGIN.y + STRUCTURE_SIZE; y += 1) {
    for (let x = STRUCTURE_ORIGIN.x; x < STRUCTURE_ORIGIN.x + STRUCTURE_SIZE; x += 1) {
      const edge =
        x === STRUCTURE_ORIGIN.x ||
        y === STRUCTURE_ORIGIN.y ||
        x === STRUCTURE_ORIGIN.x + STRUCTURE_SIZE - 1 ||
        y === STRUCTURE_ORIGIN.y + STRUCTURE_SIZE - 1;
      const doorway = x === STRUCTURE_ORIGIN.x + 2 && y === STRUCTURE_ORIGIN.y + STRUCTURE_SIZE - 1;
      if (edge && !doorway) tiles.push({ x, y });
    }
  }
  return tiles;
}

/** A small yard with one walled footprint, a door, and four firefighters. */
export const trainingYard: Scenario = scenarioSchema.parse({
  id: 'training-yard',
  name: 'Training Yard',
  seed: 1104,
  width: 20,
  height: 20,
  blocked: [
    ...structureTiles(),
    { x: 10, y: 12 },
    { x: 6, y: 5 },
    { x: 15, y: 6 },
    { x: 14, y: 14 },
  ],
  objects: [
    {
      id: 'locker-staging',
      name: 'Staging locker',
      objectType: 'locker',
      position: { x: 5, y: 2 },
      state: 'stocked',
    },
    {
      id: 'door-training',
      name: 'Training door',
      objectType: 'door',
      position: { x: 10, y: 12 },
      state: 'locked',
      requiredCapability: 'force-entry',
    },
    {
      id: 'panel-alarm',
      name: 'Alarm panel',
      objectType: 'panel',
      position: { x: 7, y: 4 },
      state: 'idle',
    },
    {
      id: 'window-west',
      name: 'West window',
      objectType: 'window',
      position: { x: 8, y: 11 },
      state: 'closed',
    },
    {
      id: 'door-interior',
      name: 'Interior door',
      objectType: 'door',
      position: { x: 10, y: 10 },
      state: 'closed',
    },
  ],
  buildings: [
    {
      id: 'building-training',
      name: 'Training building',
      floor: {
        id: 'floor-training',
        name: 'Ground floor',
        entranceDoorId: 'door-training',
        entry: { x: 10, y: 11 },
        walls: [
          { x: 9, y: 10 },
          { x: 11, y: 10 },
        ],
        rooms: [
          {
            id: 'room-south',
            name: 'Entry room',
            tiles: [
              { x: 9, y: 11 },
              { x: 10, y: 11 },
              { x: 11, y: 11 },
            ],
            entrance: { x: 10, y: 11 },
            searchTiles: [
              { x: 9, y: 11 },
              { x: 11, y: 11 },
            ],
          },
          {
            id: 'room-north',
            name: 'North room',
            tiles: [
              { x: 9, y: 9 },
              { x: 10, y: 9 },
              { x: 11, y: 9 },
            ],
            entrance: { x: 10, y: 9 },
            searchTiles: [
              { x: 9, y: 9 },
              { x: 11, y: 9 },
            ],
            discoveries: [
              { id: 'find-dummy', name: 'Training dummy', position: { x: 9, y: 9 } },
            ],
          },
        ],
      },
    },
  ],
  equipmentCatalog: [
    { id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] },
    { id: 'medical-bag', name: 'Medical bag', capabilities: ['medical'] },
    {
      id: 'extinguisher',
      name: 'Fire extinguisher',
      capabilities: ['extinguish', 'suppress'],
      agent: 80,
      suppression: 0.02,
    },
    {
      id: 'supply-hose',
      name: 'Supply hose',
      capabilities: ['supply'],
      maxLength: 10,
    },
    {
      id: 'attack-hose',
      name: 'Attack hose',
      capabilities: ['attack', 'suppress'],
      suppression: 0.05,
      maxLength: 16,
    },
    {
      id: 'scba',
      name: 'SCBA',
      capabilities: ['breathing-apparatus'],
      agent: 2400,
    },
  ],
  equipment: [
    { id: 'item-halligan', definitionId: 'halligan', locationId: 'locker-staging' },
    { id: 'item-bag', definitionId: 'medical-bag', locationId: 'locker-staging' },
    { id: 'item-extinguisher', definitionId: 'extinguisher', locationId: 'locker-staging' },
    { id: 'item-engine-halligan', definitionId: 'halligan', locationId: 'apparatus-engine-1' },
    { id: 'item-engine-bag', definitionId: 'medical-bag', locationId: 'apparatus-engine-1' },
    {
      id: 'item-engine-extinguisher',
      definitionId: 'extinguisher',
      locationId: 'apparatus-engine-1',
    },
    { id: 'item-supply-hose', definitionId: 'supply-hose', locationId: 'apparatus-engine-1' },
    { id: 'item-attack-hose', definitionId: 'attack-hose', locationId: 'apparatus-engine-1' },
    { id: 'item-scba', definitionId: 'scba', locationId: 'locker-staging' },
    { id: 'item-engine-scba', definitionId: 'scba', locationId: 'apparatus-engine-1' },
  ],
  inventoryCapacity: 2,
  roadNodes: [
    { id: 'n-north', position: { x: 1, y: 4 }, kind: 'spawn' },
    { id: 'n-east-north', position: { x: 17, y: 4 }, kind: 'intersection' },
    { id: 'n-staging', position: { x: 17, y: 10 }, kind: 'staging' },
    { id: 'n-east-south', position: { x: 17, y: 16 }, kind: 'intersection' },
    { id: 'n-south', position: { x: 1, y: 16 }, kind: 'intersection' },
    { id: 'n-west', position: { x: 1, y: 10 }, kind: 'intersection' },
  ],
  roadEdges: [
    { from: 'n-north', to: 'n-east-north' },
    { from: 'n-east-north', to: 'n-staging' },
    { from: 'n-staging', to: 'n-east-south' },
    { from: 'n-east-south', to: 'n-south' },
    { from: 'n-south', to: 'n-west' },
    { from: 'n-west', to: 'n-north' },
  ],
  vehicleCatalog: [
    {
      id: 'fire_engine_standard',
      capacity: 4,
      speed: 8,
      footprint: { width: 2, height: 1 },
      pump: { tankCapacity: 80, maxDelivery: 1 },
    },
  ],
  vehicles: [
    {
      id: 'apparatus-engine-1',
      name: 'Engine 1',
      definitionId: 'fire_engine_standard',
      nodeId: 'n-north',
      heading: 0,
    },
  ],
  hydrants: [
    {
      id: 'hydrant-staging',
      name: 'Staging hydrant',
      position: { x: 15, y: 10 },
      flowCapacity: 1,
    },
  ],
  fires: [
    {
      id: 'fire-training',
      name: 'Training fire',
      position: { x: 10, y: 11 },
      intensity: 0.45,
      maxIntensity: 1,
      fuel: 600,
      growth: 0.001,
      fuelUse: 0.02,
      range: 2,
    },
  ],
  incidents: [
    {
      id: 'incident-training',
      name: 'Training fire',
      objectives: [{ id: 'objective-suppress', kind: 'suppress-fire', targetId: 'fire-training' }],
    },
  ],
  furnishings: [
    {
      id: 'couch-entry',
      name: 'Couch',
      position: { x: 9, y: 11 },
      materialId: 'upholstery',
    },
  ],
  pathways: sidewalk(),
  team: {
    id: 'engine-1',
    name: 'Engine 1',
    memberIds: ['ff-hayes', 'ff-brooks', 'ff-diaz', 'ff-cole'],
    apparatusId: 'apparatus-engine-1',
  },
  responders: [
    { id: 'ff-hayes', name: 'Hayes', position: { x: 2, y: 2 }, speed: 3.5 },
    { id: 'ff-brooks', name: 'Brooks', position: { x: 3, y: 2 }, speed: 3.5 },
    { id: 'ff-diaz', name: 'Diaz', position: { x: 2, y: 3 }, speed: 3.5 },
    { id: 'ff-cole', name: 'Cole', position: { x: 3, y: 3 }, speed: 3.5 },
  ],
});
