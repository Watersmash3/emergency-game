import type { Tile } from '@emergency/protocol';

export type DoorState = 'open' | 'closed' | 'locked' | 'forced';

export type RoomState = 'unsearched' | 'searching' | 'searched' | 'blocked';

export interface Discovery {
  id: string;
  name: string;
  position: Tile;
  found: boolean;
}

export interface RoomRecord {
  id: string;
  buildingId: string;
  floorId: string;
  name: string;
  tiles: Tile[];
  entrance: Tile;
  searchTiles: Tile[];
  state: RoomState;
  discovered: boolean;
  assigneeId: string | null;
  reservedByTaskId: string | null;
  discoveries: Discovery[];
  upperTemp: number;
  lowerTemp: number;
  smoke: number;
  oxygen: number;
  overhauled: boolean;
  flashed: boolean;
}

export interface FloorRecord {
  id: string;
  buildingId: string;
  name: string;
  entranceDoorId: string;
  entry: Tile;
  walls: Tile[];
}

export interface BuildingRecord {
  id: string;
  name: string;
  floorId: string;
}

export interface DoorLink {
  doorId: string;
  buildingId: string;
  roomIds: string[];
  outside: boolean;
}

export function doorPassable(state: string): boolean {
  return state === 'open' || state === 'forced';
}
