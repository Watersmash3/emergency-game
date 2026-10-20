import type { Tile } from '@emergency/protocol';

import { doorPassable } from '../components/building.ts';
import type { EquipmentInstance } from '../components/equipment.ts';
import {
  AMBIENT_TEMPERATURE,
  BREATHING_CAPABILITY,
  type HazardCell,
  hazardKey,
} from '../components/hazard.ts';
import type { World } from '../core/world.ts';
import type { Entity } from '../entities/Entity.ts';
import { findPath } from '../navigation/aStar.ts';
import { inBounds, isWalkable, tileOf } from '../navigation/grid.ts';
import { clearRoute, isOpen, nextIdentifier, overrideWith } from '../tasks/lifecycle.ts';
import { noteHazard } from '../tasks/notices.ts';
import { transition } from '../tasks/transitions.ts';
import type { MoveTask } from '../tasks/types.ts';

const SPREAD_COMBUSTION = 0.2;
const SPREAD_TEMPERATURE = 50;
const WITHDRAW_EXPOSURE = 0.85;
const STEPS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function stepHazards(world: World): void {
  const live = syncIgnition(world);
  spread(world, live);
  moveSmoke(world);
  settle(world, live);
  prune(world, live);
  expose(world);
}

/** Wet a tile and its open neighbors. The ignition intensity is reduced by the caller. */
export function applyWater(world: World, tile: Tile, amount: number): void {
  if (amount <= 0) return;
  const tiles = [tile, ...openNeighbors(world, tile)];
  for (const target of tiles) {
    const cell = world.hazards.get(hazardKey(target.x, target.y));
    if (!cell) continue;
    const dose = target === tile ? amount : amount * 0.25;
    cell.water = Math.min(1, cell.water + dose * 0.35);
    cell.temperature = Math.max(AMBIENT_TEMPERATURE, cell.temperature - dose * 25);
    cell.combustion = Math.max(0, cell.combustion - dose * 0.2);
    cell.smoke = Math.max(0, cell.smoke - dose * 0.08);
  }
}

/** Prefer the hottest cell this fire still owns, then the ignition tile. */
export function suppressionTile(world: World, fireId: string): Tile {
  const entity = world.entities.get(fireId);
  const origin = entity?.position ? tileOf(entity.position) : { x: 0, y: 0 };
  let best = origin;
  let score = -1;
  for (const cell of world.hazards.values()) {
    if (cell.sourceId !== fireId) continue;
    const heat = cell.combustion * 10 + cell.temperature / 100;
    if (heat > score || (heat === score && (cell.y < best.y || (cell.y === best.y && cell.x < best.x)))) {
      score = heat;
      best = { x: cell.x, y: cell.y };
    }
  }
  return best;
}

function syncIgnition(world: World): Set<string> {
  const live = new Set<string>();
  const entities = [...world.entities.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const entity of entities) {
    if (!entity.fire || !entity.position) continue;
    const tile = tileOf(entity.position);
    const key = hazardKey(tile.x, tile.y);
    const existing = world.hazards.get(key);
    if (entity.fire.intensity <= 0) {
      if (existing?.sourceId === entity.id) {
        existing.combustion = 0;
        existing.fuel = entity.fire.fuel;
      }
      continue;
    }
    const cell = existing ?? fresh(tile, materialAt(world, tile), entity.id);
    cell.combustion = Math.min(1, entity.fire.intensity / entity.fire.maxIntensity);
    cell.fuel = entity.fire.fuel;
    cell.temperature = Math.max(cell.temperature, AMBIENT_TEMPERATURE + cell.combustion * 220);
    cell.sourceId = entity.id;
    world.hazards.set(key, cell);
    live.add(key);
  }
  return live;
}

function spread(world: World, live: Set<string>): void {
  const pending = new Map<string, HazardCell>();
  for (const key of [...world.hazards.keys()].sort()) {
    const cell = world.hazards.get(key);
    if (!cell || cell.combustion < SPREAD_COMBUSTION || cell.temperature < SPREAD_TEMPERATURE) continue;
    for (const target of spreadTargets(world, cell)) {
      const id = hazardKey(target.x, target.y);
      if (live.has(id)) continue;
      const material = materialAt(world, target);
      const current = pending.get(id) ?? world.hazards.get(id);
      const next = current ? { ...current } : fresh(target, material, cell.sourceId);
      const gain = 0.012 * material.flammability * cell.combustion * (1 - next.water);
      next.combustion = Math.min(1, next.combustion + gain);
      next.temperature = Math.min(360, next.temperature + 2 * cell.combustion);
      pending.set(id, next);
    }
  }
  for (const key of [...pending.keys()].sort()) {
    const cell = pending.get(key);
    if (cell) world.hazards.set(key, cell);
  }
}

function moveSmoke(world: World): void {
  const delta = new Map<string, number>();
  const born = new Map<string, string>();
  for (const key of [...world.hazards.keys()].sort()) {
    const cell = world.hazards.get(key);
    if (!cell) continue;
    const produced = 0.05 * cell.combustion;
    const open = openNeighbors(world, { x: cell.x, y: cell.y });
    if (open.length === 0) {
      delta.set(key, (delta.get(key) ?? 0) + produced - cell.smoke * 0.01);
      continue;
    }
    const leaving = cell.smoke * 0.08;
    delta.set(key, (delta.get(key) ?? 0) + produced - leaving);
    const share = leaving / open.length;
    for (const tile of open) {
      const id = hazardKey(tile.x, tile.y);
      delta.set(id, (delta.get(id) ?? 0) + share);
      if (!world.hazards.has(id) && !born.has(id)) born.set(id, cell.sourceId);
    }
  }
  for (const key of [...delta.keys()].sort()) {
    const change = delta.get(key) ?? 0;
    let cell = world.hazards.get(key);
    if (!cell) {
      if (change < 0.001) continue;
      const tile = tileFromKey(key);
      if (!tile || barrier(world, tile)) continue;
      cell = fresh(tile, materialAt(world, tile), born.get(key) ?? 'smoke');
      cell.fuel = 0;
      cell.combustion = 0;
      world.hazards.set(key, cell);
    }
    cell.smoke = clamp(cell.smoke + change, 0, 1);
  }
}

function settle(world: World, live: Set<string>): void {
  for (const key of [...world.hazards.keys()].sort()) {
    const cell = world.hazards.get(key);
    if (!cell) continue;
    cell.water = Math.max(0, cell.water * 0.992);
    if (live.has(key)) continue;
    cell.fuel = Math.max(0, cell.fuel - 0.008 * cell.combustion);
    if (cell.fuel <= 0) cell.combustion = Math.max(0, cell.combustion - 0.04);
    const cooled = cell.temperature + (AMBIENT_TEMPERATURE - cell.temperature) * 0.03;
    cell.temperature = clamp(cooled + cell.combustion * 5, AMBIENT_TEMPERATURE, 360);
  }
}

function prune(world: World, live: Set<string>): void {
  for (const key of [...world.hazards.keys()].sort()) {
    if (live.has(key)) continue;
    const cell = world.hazards.get(key);
    if (!cell) continue;
    const idle =
      cell.combustion < 0.001 &&
      cell.smoke < 0.005 &&
      cell.water < 0.02 &&
      cell.temperature < AMBIENT_TEMPERATURE + 8;
    if (idle) world.hazards.delete(key);
  }
}

function expose(world: World): void {
  const responders = [...world.entities.values()]
    .filter((entity) => entity.responder && entity.position)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const entity of responders) {
    if (!entity.position || entity.responder?.aboardVehicleId) continue;
    const tile = tileOf(entity.position);
    const cell = world.hazards.get(hazardKey(tile.x, tile.y));
    const smoke = cell?.smoke ?? 0;
    const temperature = cell?.temperature ?? AMBIENT_TEMPERATURE;
    const hazardous = smoke > 0.25 || temperature > 80;
    const pack = breathingPack(world, entity.id);
    let exposure = world.exposure.get(entity.id) ?? 0;
    if (!hazardous) {
      exposure = Math.max(0, exposure - 0.006);
      world.noticeLatch.delete(`hazard:${entity.id}`);
      world.noticeLatch.delete(`withdraw:${entity.id}`);
      world.noticeLatch.delete(`air:${entity.id}`);
    } else if (pack && (pack.agent ?? 0) > 0) {
      pack.agent = (pack.agent ?? 0) - 1;
      exposure += 0.0004;
      if ((pack.agent ?? 0) <= 0) {
        noteHazard(world, `air:${entity.id}`, `${entity.responder?.name ?? entity.id} is out of air.`);
      }
    } else {
      exposure += smoke * 0.012 + Math.max(0, temperature - 60) * 0.00035;
      noteHazard(
        world,
        `hazard:${entity.id}`,
        `${entity.responder?.name ?? entity.id} is in a hazardous atmosphere without breathing apparatus.`,
      );
    }
    exposure = clamp(exposure, 0, 1);
    if (exposure <= 0) world.exposure.delete(entity.id);
    else world.exposure.set(entity.id, exposure);
    const depleted = hazardous && pack !== undefined && (pack.agent ?? 0) <= 0;
    if (hazardous && (exposure >= WITHDRAW_EXPOSURE || depleted)) withdraw(world, entity);
  }
}

function withdraw(world: World, entity: Entity): void {
  const groupId = `withdraw:${entity.id}`;
  const already = [...world.tasks.values()].some(
    (task) => task.assigneeId === entity.id && task.groupId === groupId && isOpen(task.state),
  );
  if (already || !entity.position) return;
  const from = tileOf(entity.position);
  const safe = safestReachable(world, from);
  const name = entity.responder?.name ?? entity.id;
  if (!safe || (safe.x === from.x && safe.y === from.y)) {
    noteHazard(world, `withdraw:${entity.id}`, `${name} cannot leave the hazard.`);
    return;
  }
  const task: MoveTask = {
    id: nextIdentifier(world, 'task'),
    kind: 'move',
    state: 'pending',
    assigneeId: entity.id,
    source: 'individual',
    groupId,
    destination: safe,
    reservations: [],
  };
  transition(task, 'ready');
  transition(task, 'running');
  world.tasks.set(task.id, task);
  overrideWith(world, entity.id, task.id);
  clearRoute(entity);
  noteHazard(world, `withdraw:${entity.id}`, `${name} is withdrawing from the hazard.`);
}

function safestReachable(world: World, from: Tile): Tile | null {
  let best: { tile: Tile; score: number } | null = null;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const tile = { x, y };
      if (!isWalkable(world.width, world.height, world.blocked, tile)) continue;
      if (!findPath(world, from, tile)) continue;
      const cell = world.hazards.get(hazardKey(x, y));
      const smoke = cell?.smoke ?? 0;
      const temperature = cell?.temperature ?? AMBIENT_TEMPERATURE;
      const score =
        smoke * 4 +
        Math.max(0, temperature - AMBIENT_TEMPERATURE) / 40 +
        (insideRoom(world, tile) ? 1 : 0) +
        (Math.abs(x - from.x) + Math.abs(y - from.y)) * 0.02;
      if (
        !best ||
        score < best.score ||
        (score === best.score && (y < best.tile.y || (y === best.tile.y && x < best.tile.x)))
      ) {
        best = { tile, score };
      }
    }
  }
  return best?.tile ?? null;
}

function spreadTargets(world: World, cell: HazardCell): Tile[] {
  const targets: Tile[] = [];
  for (const step of STEPS) {
    const next = { x: cell.x + step.x, y: cell.y + step.y };
    if (barrier(world, next)) continue;
    if (materialAt(world, next).flammability > 0) {
      targets.push(next);
      continue;
    }
    if (!openDoor(world, next)) continue;
    const beyond = { x: next.x + step.x, y: next.y + step.y };
    if (barrier(world, beyond) || materialAt(world, beyond).flammability <= 0) continue;
    targets.push(beyond);
  }
  return targets;
}

function openNeighbors(world: World, tile: Tile): Tile[] {
  const neighbors: Tile[] = [];
  for (const step of STEPS) {
    const next = { x: tile.x + step.x, y: tile.y + step.y };
    if (!barrier(world, next)) neighbors.push(next);
  }
  return neighbors;
}

function barrier(world: World, tile: Tile): boolean {
  if (!inBounds(world.width, world.height, tile)) return true;
  return !isWalkable(world.width, world.height, world.blocked, tile);
}

function materialAt(world: World, tile: Tile): { flammability: number; fuel: number } {
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) {
      return { flammability: 0.45, fuel: 40 };
    }
  }
  if (openDoor(world, tile)) return { flammability: 0.08, fuel: 1 };
  return { flammability: 0, fuel: 0 };
}

function openDoor(world: World, tile: Tile): boolean {
  for (const entity of world.entities.values()) {
    if (entity.interactable?.objectType !== 'door' || !entity.position) continue;
    const at = tileOf(entity.position);
    if (at.x !== tile.x || at.y !== tile.y) continue;
    return doorPassable(entity.interactable.state);
  }
  return false;
}

function insideRoom(world: World, tile: Tile): boolean {
  for (const room of world.rooms.values()) {
    if (room.tiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) return true;
  }
  return false;
}

function breathingPack(world: World, responderId: string): EquipmentInstance | undefined {
  return [...world.equipment.values()]
    .filter((item) => {
      if (item.ownerId !== responderId) return false;
      const definition = world.catalog.get(item.definitionId);
      return definition?.capabilities.includes(BREATHING_CAPABILITY) ?? false;
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
}

function fresh(
  tile: Tile,
  material: { flammability: number; fuel: number },
  sourceId: string,
): HazardCell {
  return {
    x: tile.x,
    y: tile.y,
    temperature: AMBIENT_TEMPERATURE,
    fuel: material.fuel,
    combustion: 0,
    smoke: 0,
    water: 0,
    sourceId,
  };
}

function tileFromKey(key: string): Tile | null {
  const [x, y] = key.split(',');
  if (!x || !y) return null;
  const parsed = { x: Number(x), y: Number(y) };
  if (!Number.isInteger(parsed.x) || !Number.isInteger(parsed.y)) return null;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function exposureRows(
  world: World,
): { responderId: string; exposure: number; air: number | null }[] {
  const rows: { responderId: string; exposure: number; air: number | null }[] = [];
  const responders = [...world.entities.values()]
    .filter((entity) => entity.responder)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const entity of responders) {
    const pack = breathingPack(world, entity.id);
    const exposure = world.exposure.get(entity.id) ?? 0;
    const air = pack ? (pack.agent ?? 0) : null;
    if (exposure <= 0 && air === null) continue;
    rows.push({ responderId: entity.id, exposure, air });
  }
  return rows;
}

export function hazardRows(world: World): HazardCell[] {
  return [...world.hazards.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}
