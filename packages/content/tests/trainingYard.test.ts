import { describe, expect, it } from 'vitest';

import { trainingYard } from '../src/index.ts';

describe('training yard', () => {
  it('places four responders on one team', () => {
    expect(trainingYard.responders).toHaveLength(4);
    expect(trainingYard.team.memberIds).toEqual(
      trainingYard.responders.map((responder) => responder.id),
    );
    expect(trainingYard.blocked.length).toBeGreaterThan(0);
    expect(trainingYard.objects.map((object) => object.objectType)).toEqual([
      'locker',
      'door',
      'panel',
    ]);
    expect(trainingYard.equipment).toHaveLength(8);
    expect(trainingYard.hydrants.map((hydrant) => hydrant.id)).toEqual(['hydrant-staging']);
    expect(trainingYard.blocked).toContainEqual({ x: 10, y: 12 });
    expect(trainingYard.team.apparatusId).toBe('apparatus-engine-1');
    expect(trainingYard.vehicles).toHaveLength(1);
    expect(trainingYard.vehicles[0]?.definitionId).toBe('fire_engine_standard');
    expect(trainingYard.roadNodes.map((node) => node.id)).toContain('n-staging');
    expect(trainingYard.fires.map((fire) => fire.position)).toEqual([{ x: 10, y: 14 }]);
    expect(trainingYard.incidents.map((incident) => incident.id)).toEqual(['incident-training']);
    expect(
      trainingYard.equipmentCatalog.find((item) => item.id === 'extinguisher')?.capabilities,
    ).toContain('suppress');
  });
});
