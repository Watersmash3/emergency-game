import type { SimulationSnapshot, Tile } from '@emergency/protocol';

import { TILE_HEIGHT, TILE_WIDTH, worldToScreen } from './iso.ts';

export type WallRole = 'far' | 'near' | 'partition';
export type DoorAxis = 'x' | 'y';
export type WallPresentation = 'full' | 'curb';

export interface WallPiece {
  x: number;
  y: number;
  role: WallRole;
}

export interface DoorPiece {
  id: string;
  x: number;
  y: number;
  axis: DoorAxis;
  interior: boolean;
  state: string;
}

export interface FloorPiece {
  x: number;
  y: number;
  roomId: string;
  variant: number;
  state: 'unsearched' | 'searching' | 'searched' | 'blocked';
  discovered: boolean;
}

export interface BuildingView {
  floors: FloorPiece[];
  walls: WallPiece[];
  doors: DoorPiece[];
  roofs: Tile[];
  obstacles: Tile[];
}

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Turn blocked tiles, rooms, and doors into modular pieces the renderer can assemble. */
export function assembleBuilding(snapshot: SimulationSnapshot): BuildingView {
  const blocked = new Set(snapshot.blocked.map((tile) => keyOf(tile)));
  const roomAt = new Map<string, { id: string; state: FloorPiece['state']; discovered: boolean }>();
  const variantOf = new Map<string, number>();
  snapshot.rooms.forEach((room, index) => {
    variantOf.set(room.id, index % 2);
    for (const tile of room.tiles) {
      roomAt.set(keyOf(tile), { id: room.id, state: room.state, discovered: room.discovered });
    }
  });
  const doors = new Map(
    snapshot.objects
      .filter((object) => object.objectType === 'door')
      .map((object) => [keyOf(object.position), object]),
  );
  const entrances = new Set(snapshot.buildings.map((building) => building.entranceDoorId));

  const shell = new Set<string>();
  const queue: Tile[] = [];
  const enqueue = (tile: Tile) => {
    const key = keyOf(tile);
    if (!blocked.has(key) || shell.has(key)) return;
    shell.add(key);
    queue.push(tile);
  };
  for (const room of snapshot.rooms) {
    for (const tile of room.tiles) {
      for (const step of DIRECTIONS) enqueue({ x: tile.x + step.x, y: tile.y + step.y });
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const tile = queue[index];
    if (!tile) continue;
    for (const step of DIRECTIONS) enqueue({ x: tile.x + step.x, y: tile.y + step.y });
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const room of snapshot.rooms) {
    for (const tile of room.tiles) {
      sumX += tile.x;
      sumY += tile.y;
      count += 1;
    }
  }
  const center = count > 0 ? sumX / count + sumY / count : 0;

  const walls: WallPiece[] = [];
  for (const key of shell) {
    if (doors.has(key)) continue;
    const tile = fromKey(key);
    walls.push({ ...tile, role: wallRole(tile, roomAt, center) });
  }
  walls.sort((left, right) => left.y - right.y || left.x - right.x);

  const doorPieces: DoorPiece[] = [];
  for (const [key, door] of doors) {
    if (!shell.has(key) && !adjacentTo(key, roomAt)) continue;
    const tile = fromKey(key);
    doorPieces.push({
      id: door.id,
      x: tile.x,
      y: tile.y,
      axis: doorAxis(tile, shell, doors),
      interior: !entrances.has(door.id),
      state: door.state,
    });
  }
  doorPieces.sort((left, right) => (left.id < right.id ? -1 : 1));

  const floors: FloorPiece[] = snapshot.rooms.flatMap((room) =>
    room.tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      roomId: room.id,
      variant: variantOf.get(room.id) ?? 0,
      state: room.state,
      discovered: room.discovered,
    })),
  );

  const roofs: Tile[] = [];
  const seenRoof = new Set<string>();
  const addRoof = (tile: Tile) => {
    const key = keyOf(tile);
    if (seenRoof.has(key)) return;
    seenRoof.add(key);
    roofs.push({ x: tile.x, y: tile.y });
  };
  for (const floor of floors) addRoof(floor);
  for (const key of shell) addRoof(fromKey(key));

  const obstacles = snapshot.blocked.filter((tile) => {
    const key = keyOf(tile);
    return !shell.has(key) && !roomAt.has(key);
  });

  return { floors, walls, doors: doorPieces, roofs, obstacles };
}

/** Matches the full wall sprite, so a closed roof can sit on the outer wall tops. */
export const WALL_RISE = 28;

/** Tiles under a closed roof: the shell and the rooms, leaving the entrance opening out. */
export function roofCover(view: BuildingView): Tile[] {
  const skip = new Set(view.doors.filter((door) => !door.interior).map((door) => `${door.x},${door.y}`));
  const tiles: Tile[] = [];
  const add = (tile: Tile) => {
    const key = `${tile.x},${tile.y}`;
    if (skip.has(key)) return;
    skip.add(key);
    tiles.push({ x: tile.x, y: tile.y });
  };
  for (const floor of view.floors) add(floor);
  for (const wall of view.walls) add(wall);
  for (const door of view.doors) {
    if (door.interior) add(door);
  }
  return tiles;
}

/**
 * Screen polygon for a closed roof. The shape includes each tile diamond and the same
 * diamond lifted toward the wall tops, so the slab covers the floor and reads as a cap.
 */
export function roofOutline(tiles: Tile[], lift: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const halfW = TILE_WIDTH / 2;
  const halfH = TILE_HEIGHT / 2;
  for (const tile of tiles) {
    const center = worldToScreen(tile.x + 0.5, tile.y + 0.5);
    const corners = [
      { x: center.x, y: center.y - halfH },
      { x: center.x + halfW, y: center.y },
      { x: center.x, y: center.y + halfH },
      { x: center.x - halfW, y: center.y },
    ];
    for (const corner of corners) {
      points.push(corner);
      points.push({ x: corner.x, y: corner.y - lift });
    }
  }
  return convexHull(points);
}

/** Far walls stay up during a cutaway. Near walls and partitions drop to a curb. */
export function wallPresentation(role: WallRole, revealed: boolean): WallPresentation {
  if (!revealed || role === 'far') return 'full';
  return 'curb';
}

export function showWorldLabel(input: {
  debug: boolean;
  hovered: boolean;
  selected: boolean;
  zoom: number;
}): boolean {
  if (input.debug || input.hovered || input.selected) return true;
  return input.zoom >= 1.7;
}

function wallRole(
  tile: Tile,
  rooms: Map<string, { id: string }>,
  center: number,
): WallRole {
  const around = DIRECTIONS.map((step) => rooms.get(keyOf({ x: tile.x + step.x, y: tile.y + step.y }))).filter(
    (room) => room !== undefined,
  );
  const sums = DIRECTIONS.map((step) => ({
    room: rooms.has(keyOf({ x: tile.x + step.x, y: tile.y + step.y })),
    sum: tile.x + step.x + tile.y + step.y,
  })).filter((entry) => entry.room);
  const closer = sums.some((entry) => entry.sum > tile.x + tile.y);
  const farther = sums.some((entry) => entry.sum < tile.x + tile.y);
  if (around.length >= 2 && closer && farther) return 'partition';
  if (tile.x + tile.y >= center) return 'near';
  return 'far';
}

function doorAxis(tile: Tile, shell: Set<string>, doors: Map<string, { id: string }>): DoorAxis {
  const west = keyOf({ x: tile.x - 1, y: tile.y });
  const east = keyOf({ x: tile.x + 1, y: tile.y });
  const alongX = (shell.has(west) || doors.has(west)) && (shell.has(east) || doors.has(east));
  return alongX ? 'x' : 'y';
}

function adjacentTo(key: string, rooms: Map<string, unknown>): boolean {
  const tile = fromKey(key);
  return DIRECTIONS.some((step) => rooms.has(keyOf({ x: tile.x + step.x, y: tile.y + step.y })));
}

function keyOf(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

function fromKey(key: string): Tile {
  const [x, y] = key.split(',');
  return { x: Number(x), y: Number(y) };
}

function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const unique: { x: number; y: number }[] = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    unique.push(point);
  }
  if (unique.length <= 2) return unique;
  const cross = (origin: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const build = (source: { x: number; y: number }[]) => {
    const chain: { x: number; y: number }[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) {
        chain.pop();
      }
      chain.push(point);
    }
    return chain;
  };
  const lower = build(unique);
  const upper = build([...unique].reverse());
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
