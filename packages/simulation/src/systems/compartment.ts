import type { Tile } from '@emergency/protocol';

import { doorPassable, type RoomRecord } from '../components/building.ts';
import { AMBIENT_TEMPERATURE, hazardKey } from '../components/hazard.ts';
import { materialById, materialForTile } from '../components/material.ts';
import type { World } from '../core/world.ts';
import { tileKey, tileOf } from '../navigation/grid.ts';
import { setDoorState, roomAt } from '../tasks/building.ts';
import { noteHazard } from '../tasks/notices.ts';

const STEPS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function oxygenAt(world: World, tile: Tile): number {
  return roomAt(world, tile)?.oxygen ?? 1;
}

/** Aggregate room atmosphere from the grid, then move a bounded share through openings. */
export function stepAtmosphere(world: World, live: Set<string>): void {
  const rooms = [...world.rooms.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const room of rooms) aggregate(world, room);
  exchange(world, rooms);
  for (const room of rooms) growRapidly(world, room, live);
  rekindle(world, live);
}

export function markHotspots(world: World, live: Set<string>): void {
  for (const key of [...world.hazards.keys()].sort()) {
    if (live.has(key)) continue;
    const cell = world.hazards.get(key);
    if (!cell) continue;
    const material = materialById(cell.materialId);
    if (
      cell.combustion <= 0.05 &&
      cell.temperature >= material.ignition &&
      cell.fuel > 0.4 &&
      cell.water < 0.25
    ) {
      cell.hotspot = true;
    }
    if (cell.hotspot && cell.temperature < material.ignition - 10) cell.hotspot = false;
  }
}

export function degradeStructure(world: World): void {
  const walls = [...world.floors.values()]
    .flatMap((floor) => floor.walls)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  for (const wall of walls) heatWall(world, wall);
  const doors = [...world.entities.values()]
    .filter((entity) => entity.interactable?.objectType === 'door' && entity.position)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const door of doors) {
    if (!door.position || !door.interactable) continue;
    if (doorPassable(door.interactable.state)) continue;
    const tile = tileOf(door.position);
    const before = world.damage.get(`door:${door.id}`)?.failed ?? false;
    const record = heatRecord(world, `door:${door.id}`, tile, adjacentTemperature(world, tile));
    if (before || !record.failed) continue;
    setDoorState(world, door, 'forced');
    noteHazard(world, `failed:${door.id}`, `${door.interactable.name} fails from the heat.`);
  }
}

function aggregate(world: World, room: RoomRecord): void {
  let hottest = AMBIENT_TEMPERATURE;
  let smoke = 0;
  let combustion = 0;
  for (const tile of room.tiles) {
    const cell = world.hazards.get(hazardKey(tile.x, tile.y));
    const temperature = cell?.temperature ?? AMBIENT_TEMPERATURE;
    if (temperature > hottest) hottest = temperature;
    smoke += cell?.smoke ?? 0;
    combustion += cell?.combustion ?? 0;
  }
  const count = Math.max(1, room.tiles.length);
  const averageSmoke = smoke / count;
  room.upperTemp = finite(room.upperTemp + (hottest - room.upperTemp) * 0.18, AMBIENT_TEMPERATURE);
  room.lowerTemp = finite(
    room.lowerTemp + (AMBIENT_TEMPERATURE + (room.upperTemp - AMBIENT_TEMPERATURE) * 0.35 - room.lowerTemp) * 0.12,
    AMBIENT_TEMPERATURE,
  );
  room.smoke = clamp(room.smoke + (averageSmoke - room.smoke) * 0.25, 0, 1);
  room.oxygen = clamp(room.oxygen - (combustion / count) * 0.006, 0.08, 1);
}

function exchange(world: World, rooms: RoomRecord[]): void {
  const links = openings(world);
  for (const link of links) {
    const left = link.left ? world.rooms.get(link.left) : undefined;
    const right = link.right ? world.rooms.get(link.right) : undefined;
    const rate = link.conductance * 0.1;
    const leftSmoke = left?.smoke ?? 0;
    const rightSmoke = right?.smoke ?? 0;
    const leftOxygen = left?.oxygen ?? 1;
    const rightOxygen = right?.oxygen ?? 1;
    const leftHeat = left?.upperTemp ?? AMBIENT_TEMPERATURE;
    const rightHeat = right?.upperTemp ?? AMBIENT_TEMPERATURE;
    if (left) {
      left.smoke = clamp(left.smoke + (rightSmoke - leftSmoke) * rate, 0, 1);
      left.oxygen = clamp(left.oxygen + (rightOxygen - leftOxygen) * rate, 0.08, 1);
      left.upperTemp = finite(left.upperTemp + (rightHeat - leftHeat) * rate * 0.5, AMBIENT_TEMPERATURE);
    }
    if (right) {
      right.smoke = clamp(right.smoke + (leftSmoke - rightSmoke) * rate, 0, 1);
      right.oxygen = clamp(right.oxygen + (leftOxygen - rightOxygen) * rate, 0.08, 1);
      right.upperTemp = finite(right.upperTemp + (leftHeat - rightHeat) * rate * 0.5, AMBIENT_TEMPERATURE);
    }
  }
  for (const room of rooms) {
    room.smoke = clamp(room.smoke, 0, 1);
    room.oxygen = clamp(room.oxygen, 0.08, 1);
    room.upperTemp = clamp(room.upperTemp, AMBIENT_TEMPERATURE, 400);
    room.lowerTemp = clamp(room.lowerTemp, AMBIENT_TEMPERATURE, room.upperTemp);
  }
}

function growRapidly(world: World, room: RoomRecord, live: Set<string>): void {
  if (room.flashed || room.upperTemp < 210 || room.oxygen < 0.4) return;
  const sourceId = ignitionSource(world, room, live);
  let lit = 0;
  for (const tile of room.tiles) {
    const material = materialForTile(world, tile);
    if (material.combustibility < 0.2) continue;
    const key = hazardKey(tile.x, tile.y);
    if (live.has(key)) continue;
    const cell = world.hazards.get(key);
    if (!cell || cell.temperature < material.ignition - 15) continue;
    cell.combustion = Math.max(cell.combustion, 0.4);
    cell.temperature = Math.max(cell.temperature, material.ignition + 40);
    if (!cell.sourceId) cell.sourceId = sourceId;
    lit += 1;
  }
  if (lit === 0) return;
  room.flashed = true;
  noteHazard(world, `flash:${room.id}`, `${room.name} lights up across the compartment.`);
}

function ignitionSource(world: World, room: RoomRecord, live: Set<string>): string {
  for (const tile of room.tiles) {
    const cell = world.hazards.get(hazardKey(tile.x, tile.y));
    if (cell && (live.has(hazardKey(tile.x, tile.y)) || cell.combustion > 0.05)) return cell.sourceId;
  }
  for (const entity of world.entities.values()) {
    if (!entity.fire || !entity.position) continue;
    const tile = tileOf(entity.position);
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) return entity.id;
  }
  return room.id;
}

function rekindle(world: World, live: Set<string>): void {
  for (const key of [...world.hazards.keys()].sort()) {
    if (live.has(key)) continue;
    const cell = world.hazards.get(key);
    if (!cell || cell.combustion > 0.08 || cell.water >= 0.2 || cell.fuel <= 0.4) continue;
    const material = materialById(cell.materialId);
    if (cell.temperature < material.ignition || material.combustibility <= 0) continue;
    const oxygen = oxygenAt(world, cell);
    if (oxygen < 0.55) continue;
    cell.combustion = clamp(cell.combustion + 0.015 * material.combustibility * oxygen, 0, 1);
  }
}

function openings(world: World): { id: string; left: string | null; right: string | null; conductance: number }[] {
  const links: { id: string; left: string | null; right: string | null; conductance: number }[] = [];
  for (const entity of world.entities.values()) {
    if (!entity.position || !entity.interactable) continue;
    const state = entity.interactable.state;
    const passable = entity.interactable.objectType === 'door' && doorPassable(state);
    const windowOpen = entity.interactable.objectType === 'window' && state === 'open';
    if (!passable && !windowOpen) continue;
    const tile = tileOf(entity.position);
    const rooms = roomsTouching(world, tile);
    links.push({
      id: entity.id,
      left: rooms[0]?.id ?? null,
      right: rooms[1]?.id ?? null,
      conductance: windowOpen ? 0.55 : 1,
    });
  }
  for (const [id, record] of world.damage) {
    if (!record.failed || id.startsWith('door:')) continue;
    const rooms = roomsTouching(world, record);
    links.push({
      id: `wall:${record.x},${record.y}`,
      left: rooms[0]?.id ?? null,
      right: rooms[1]?.id ?? null,
      conductance: 0.75,
    });
  }
  return links.sort((left, right) => (left.id < right.id ? -1 : 1));
}

function roomsTouching(world: World, tile: Tile): RoomRecord[] {
  const found: RoomRecord[] = [];
  const seen = new Set<string>();
  const tiles = [tile, ...STEPS.map((step) => ({ x: tile.x + step.x, y: tile.y + step.y }))];
  for (const candidate of tiles) {
    const room = roomAt(world, candidate);
    if (!room || seen.has(room.id)) continue;
    seen.add(room.id);
    found.push(room);
  }
  return found.sort((left, right) => (left.id < right.id ? -1 : 1));
}

function heatWall(world: World, wall: Tile): void {
  const temperature = adjacentTemperature(world, wall);
  const record = heatRecord(world, tileKey(wall), wall, temperature);
  if (!record.failed) return;
  const key = tileKey(wall);
  if (!world.blocked.has(key)) return;
  world.blocked.delete(key);
  world.routeEpoch += 1;
  noteHazard(world, `failed:${key}`, 'A wall section fails and opens the compartment.');
}

function heatRecord(world: World, id: string, tile: Tile, temperature: number): { x: number; y: number; integrity: number; failed: boolean } {
  const current = world.damage.get(id) ?? { x: tile.x, y: tile.y, integrity: 1, failed: false };
  if (!current.failed && temperature > 170) {
    current.integrity = clamp(current.integrity - 0.004 * (temperature / 200), 0, 1);
    if (current.integrity <= 0) current.failed = true;
  }
  world.damage.set(id, current);
  return current;
}

function adjacentTemperature(world: World, tile: Tile): number {
  let hottest = AMBIENT_TEMPERATURE;
  for (const step of STEPS) {
    const cell = world.hazards.get(hazardKey(tile.x + step.x, tile.y + step.y));
    if (cell && cell.temperature > hottest) hottest = cell.temperature;
  }
  return hottest;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
