import type { World } from '../core/world.ts';
import { CONTROLLED_COMBUSTION } from '../components/hazard.ts';

/** A fire is controlled when its ignition is out and no cell it started is still burning. */
export function fireControlled(world: World, fireId: string): boolean {
  const fire = world.entities.get(fireId)?.fire;
  if (fire && fire.intensity > 0) return false;
  for (const cell of world.hazards.values()) {
    if (cell.sourceId === fireId && cell.combustion > CONTROLLED_COMBUSTION) return false;
  }
  return true;
}
