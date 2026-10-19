import { scenarioSchema, type Scenario, type Tile } from '@emergency/protocol';

const STRUCTURE_ORIGIN = { x: 8, y: 8 };
const STRUCTURE_SIZE = 5;

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
  ],
  equipmentCatalog: [
    { id: 'halligan', name: 'Halligan tool', capabilities: ['force-entry'] },
    { id: 'medical-bag', name: 'Medical bag', capabilities: ['medical'] },
    { id: 'extinguisher', name: 'Fire extinguisher', capabilities: ['extinguish'] },
  ],
  equipment: [
    { id: 'item-halligan', definitionId: 'halligan', locationId: 'locker-staging' },
    { id: 'item-bag', definitionId: 'medical-bag', locationId: 'locker-staging' },
    { id: 'item-extinguisher', definitionId: 'extinguisher', locationId: 'locker-staging' },
  ],
  inventoryCapacity: 2,
  team: {
    id: 'engine-1',
    name: 'Engine 1',
    memberIds: ['ff-hayes', 'ff-brooks', 'ff-diaz', 'ff-cole'],
  },
  responders: [
    { id: 'ff-hayes', name: 'Hayes', position: { x: 2, y: 2 }, speed: 3.5 },
    { id: 'ff-brooks', name: 'Brooks', position: { x: 3, y: 2 }, speed: 3.5 },
    { id: 'ff-diaz', name: 'Diaz', position: { x: 2, y: 3 }, speed: 3.5 },
    { id: 'ff-cole', name: 'Cole', position: { x: 3, y: 3 }, speed: 3.5 },
  ],
});
