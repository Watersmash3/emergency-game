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
  blocked: [...structureTiles(), { x: 6, y: 5 }, { x: 15, y: 6 }, { x: 14, y: 14 }],
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
