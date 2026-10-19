import { describe, expect, it } from 'vitest';

import { trainingYard } from '../src/index.ts';

describe('training yard', () => {
  it('places four responders on one team', () => {
    expect(trainingYard.responders).toHaveLength(4);
    expect(trainingYard.team.memberIds).toEqual(
      trainingYard.responders.map((responder) => responder.id),
    );
    expect(trainingYard.blocked.length).toBeGreaterThan(0);
  });
});
