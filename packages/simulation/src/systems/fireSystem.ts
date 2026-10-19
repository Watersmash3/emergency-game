import type { World } from '../core/world.ts';
import { evaluateIncidents } from '../tasks/fireRules.ts';

export function stepFire(world: World): void {
  const entities = [...world.entities.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const entity of entities) {
    const fire = entity.fire;
    if (!fire || fire.intensity <= 0 || fire.fuel <= 0) continue;
    fire.intensity = Math.min(fire.maxIntensity, fire.intensity + fire.growth);
    fire.fuel = Math.max(0, fire.fuel - fire.fuelUse);
  }
  evaluateIncidents(world);
}
