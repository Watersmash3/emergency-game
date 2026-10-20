import type { SimulationSnapshot } from '@emergency/protocol';

export type RoofMode = 'auto' | 'open' | 'closed';

export function interiorRevealed(
  mode: RoofMode,
  selectionInside: boolean,
  roomFocused = false,
  entranceOpen = false,
): boolean {
  if (mode === 'open') return true;
  if (mode === 'closed') return false;
  return selectionInside || roomFocused || entranceOpen;
}

/** A passable entrance or interior door means the player can see into the building. */
export function buildingInteriorOpen(snapshot: SimulationSnapshot): boolean {
  return snapshot.objects.some((object) => {
    if (object.objectType !== 'door' || (object.state !== 'open' && object.state !== 'forced')) return false;
    if (snapshot.buildings.some((building) => building.entranceDoorId === object.id)) return true;
    return snapshot.rooms.some((room) =>
      room.tiles.some((tile) => Math.abs(tile.x - object.position.x) + Math.abs(tile.y - object.position.y) === 1),
    );
  });
}

export function tileInsideRoom(snapshot: SimulationSnapshot, x: number, y: number): boolean {
  return snapshot.rooms.some((room) => room.tiles.some((tile) => tile.x === x && tile.y === y));
}

export function selectionInsideBuilding(snapshot: SimulationSnapshot, ids: string[]): boolean {
  return ids.some((id) => {
    const entity = snapshot.entities.find((candidate) => candidate.id === id);
    if (!entity || entity.aboardVehicleId) return false;
    return tileInsideRoom(snapshot, Math.floor(entity.position.x), Math.floor(entity.position.y));
  });
}
