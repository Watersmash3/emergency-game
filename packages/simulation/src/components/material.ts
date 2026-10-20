import type { Tile } from '@emergency/protocol';

import type { World } from '../core/world.ts';
import { tileOf } from '../navigation/grid.ts';
import { doorPassable } from './building.ts';

export interface Material {
  id: string;
  name: string;
  ignition: number;
  combustibility: number;
  fuel: number;
  heatRelease: number;
  conductivity: number;
  smokeYield: number;
  burnRate: number;
  cooling: number;
}

export const MATERIALS: Record<string, Material> = {
  none: {
    id: 'none',
    name: 'Noncombustible',
    ignition: 999,
    combustibility: 0,
    fuel: 0,
    heatRelease: 0,
    conductivity: 0.05,
    smokeYield: 0,
    burnRate: 0,
    cooling: 1,
  },
  wood: {
    id: 'wood',
    name: 'Wood',
    ignition: 80,
    combustibility: 0.45,
    fuel: 40,
    heatRelease: 1,
    conductivity: 1,
    smokeYield: 1,
    burnRate: 0.008,
    cooling: 1,
  },
  upholstery: {
    id: 'upholstery',
    name: 'Upholstery',
    ignition: 48,
    combustibility: 0.75,
    fuel: 18,
    heatRelease: 1.5,
    conductivity: 0.7,
    smokeYield: 1.8,
    burnRate: 0.02,
    cooling: 1.15,
  },
  tinder: {
    id: 'tinder',
    name: 'Light fuel',
    ignition: 36,
    combustibility: 0.9,
    fuel: 2,
    heatRelease: 1.2,
    conductivity: 0.5,
    smokeYield: 1.2,
    burnRate: 0.2,
    cooling: 1.3,
  },
};

export function materialById(id: string): Material {
  return MATERIALS[id] ?? catalog('none');
}

export function materialForTile(world: World, tile: Tile): Material {
  for (const furnishing of world.furnishings.values()) {
    if (furnishing.x === tile.x && furnishing.y === tile.y) return materialById(furnishing.materialId);
  }
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) {
      return catalog('wood');
    }
  }
  if (openDoorTile(world, tile)) {
    return { ...catalog('wood'), combustibility: 0.08, fuel: 1, smokeYield: 0.4 };
  }
  return catalog('none');
}

function catalog(id: string): Material {
  const material = MATERIALS[id];
  if (!material) throw new Error(`Unknown material ${id}`);
  return material;
}

function openDoorTile(world: World, tile: Tile): boolean {
  for (const entity of world.entities.values()) {
    if (entity.interactable?.objectType !== 'door' || !entity.position) continue;
    const at = tileOf(entity.position);
    if (at.x !== tile.x || at.y !== tile.y) continue;
    return doorPassable(entity.interactable.state);
  }
  return false;
}
