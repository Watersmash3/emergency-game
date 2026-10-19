import type { World } from '../core/world.ts';
import { pumpOf } from '../tasks/waterRules.ts';

/** Replenish tanks and clear last tick's attack flow. Consumption happens in the nozzle task. */
export function stepWater(world: World): void {
  const entities = [...world.entities.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const entity of entities) {
    if (entity.hose) entity.hose.flow = 0;
  }
  for (const entity of entities) {
    const pump = pumpOf(entity);
    if (!pump || !entity.vehicle) continue;
    pump.delivered = 0;
    if (entity.vehicle.status === 'moving') {
      if (pump.state === 'operating' || pump.state === 'starting') {
        pump.state = 'unavailable';
        pump.pressure = 0;
      }
    } else if (pump.state === 'unavailable') {
      pump.state = 'off';
    }
    pump.pressure = pump.state === 'operating' ? 1 : 0;
    if (pump.state !== 'operating' || !pump.intakeId) continue;
    const hose = world.entities.get(pump.intakeId)?.hose;
    if (!hose || hose.kind !== 'supply' || hose.state !== 'open' || hose.targetId !== entity.id) {
      continue;
    }
    const hydrant = hose.sourceId ? world.entities.get(hose.sourceId)?.hydrant : undefined;
    if (!hydrant?.available) continue;
    const room = pump.tankCapacity - pump.tank;
    const gain = Math.min(room, hydrant.flowCapacity);
    if (gain > 0) pump.tank += gain;
  }
}
