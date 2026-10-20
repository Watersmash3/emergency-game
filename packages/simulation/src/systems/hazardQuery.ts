import type { Tile } from '@emergency/protocol';

import { CONTROLLED_COMBUSTION } from '../components/hazard.ts';
import type { World } from '../core/world.ts';
import { tileOf } from '../navigation/grid.ts';

/** A fire is controlled when its ignition is out and no cell it started is still burning. */
export function fireControlled(world: World, fireId: string): boolean {
  const fire = world.entities.get(fireId)?.fire;
  if (fire && fire.intensity > 0) return false;
  for (const cell of world.hazards.values()) {
    if (cell.sourceId === fireId && cell.combustion > CONTROLLED_COMBUSTION) return false;
  }
  return true;
}

export function roomOverhauled(world: World, roomId: string): boolean {
  const room = world.rooms.get(roomId);
  if (!room?.overhauled) return false;
  for (const tile of room.tiles) {
    const cell = world.hazards.get(`${tile.x},${tile.y}`);
    if (!cell) continue;
    if (cell.combustion > CONTROLLED_COMBUSTION || cell.hotspot) return false;
    if (cell.temperature > 80 && cell.fuel > 0.4) return false;
  }
  return true;
}

export function incidentPhase(
  world: World,
  targetIds: readonly string[],
): 'developing' | 'contained' | 'knockdown' {
  const burning = [...world.hazards.values()].filter(
    (cell) => targetIds.includes(cell.sourceId) && cell.combustion > CONTROLLED_COMBUSTION,
  );
  const active = targetIds.some((id) => (world.entities.get(id)?.fire?.intensity ?? 0) > 0);
  if (!active && burning.length === 0) return 'knockdown';
  const origins = new Set<string>();
  for (const id of targetIds) {
    const position = world.entities.get(id)?.position;
    if (!position) continue;
    const room = roomOf(world, tileOf(position));
    if (room) origins.add(room);
  }
  const contained =
    burning.length > 0 &&
    burning.every((cell) => {
      const room = roomOf(world, cell);
      return room ? origins.has(room) : origins.size === 0;
    });
  return contained ? 'contained' : 'developing';
}

export function incidentTrend(world: World, targetIds: readonly string[]): 'growing' | 'steady' | 'dying' {
  const burning = [...world.hazards.values()].filter(
    (cell) => targetIds.includes(cell.sourceId) && cell.combustion > CONTROLLED_COMBUSTION,
  );
  if (burning.length === 0) return 'dying';
  const average = burning.reduce((sum, cell) => sum + cell.combustion, 0) / burning.length;
  if (burning.some((cell) => cell.water > 0.3) && average < 0.45) return 'dying';
  if (average > 0.5 && burning.some((cell) => cell.fuel > 4)) return 'growing';
  return 'steady';
}

function roomOf(world: World, tile: Tile): string | null {
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) return room.id;
  }
  return null;
}
