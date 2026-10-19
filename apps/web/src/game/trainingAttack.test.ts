import { trainingYard } from '@emergency/content';
import { createSimulation } from '@emergency/simulation';
import { describe, expect, it } from 'vitest';

describe('training yard fire attack', () => {
  it('parks at staging and extinguishes the fire with the engine', () => {
    const sim = createSimulation(trainingYard);
    expect(
      sim.apply({
        type: 'respond-to',
        teamId: 'engine-1',
        destinationNodeId: 'n-staging',
        disembark: true,
      }).ok,
    ).toBe(true);
    let parked = false;
    for (let tick = 0; tick < 2000; tick += 1) {
      sim.tick();
      const snapshot = sim.getSnapshot();
      const vehicle = snapshot.vehicles[0];
      if (
        vehicle?.nodeId === 'n-staging' &&
        vehicle.status === 'idle' &&
        snapshot.entities.every((entity) => !entity.aboardVehicleId)
      ) {
        parked = true;
        break;
      }
    }
    expect(parked).toBe(true);
    expect(
      sim.apply({ type: 'establish-fire-attack', teamId: 'engine-1', incidentId: 'incident-training' })
        .ok,
    ).toBe(true);
    let resolved = false;
    for (let tick = 0; tick < 4000; tick += 1) {
      sim.tick();
      if (sim.getSnapshot().incidents[0]?.state === 'resolved') {
        resolved = true;
        break;
      }
    }
    const snapshot = sim.getSnapshot();
    expect(resolved, JSON.stringify({
      incident: snapshot.incidents[0],
      pump: snapshot.vehicles[0]?.pump,
      hoses: snapshot.hoses.map((hose) => ({
        kind: hose.kind,
        state: hose.state,
        length: hose.length,
        max: hose.maxLength,
        flow: hose.flow,
      })),
      failed: snapshot.tasks
        .filter((task) => task.state === 'failed')
        .map((task) => ({
          kind: task.kind,
          reason: task.failureReason,
          role: 'role' in task ? task.role : undefined,
        })),
    })).toBe(true);
    expect(snapshot.fires[0]?.out).toBe(true);
    expect(snapshot.hoses.filter((hose) => hose.kind === 'attack')).toHaveLength(1);
  });
});
