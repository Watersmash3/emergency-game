import { trainingYard } from '@emergency/content';
import { createSimulation } from '@emergency/simulation';
import { describe, expect, it } from 'vitest';

import { commandActions } from './commands.ts';

describe('contextual commands', () => {
  const snapshot = createSimulation(trainingYard).getSnapshot();

  it('offers apparatus and incident actions for one responder', () => {
    const actions = commandActions(snapshot, { kind: 'responders', ids: ['ff-hayes'] });
    expect(actions.find((action) => action.id === 'move')?.enabled).toBe(true);
    expect(actions.find((action) => action.id === 'board')?.enabled).toBe(true);
    expect(actions.find((action) => action.id === 'exit')?.enabled).toBe(false);
    expect(actions.find((action) => action.label === 'Operate pump')?.enabled).toBe(true);
    expect(actions.find((action) => action.label === 'Suppress')?.group).toBe('incident');
  });

  it('keeps a temporary group on movement', () => {
    const actions = commandActions(snapshot, { kind: 'responders', ids: ['ff-hayes', 'ff-brooks'] });
    expect(actions.find((action) => action.id === 'move')?.enabled).toBe(true);
    expect(actions.find((action) => action.label === 'Operate pump')).toBeUndefined();
  });

  it('offers team response and fire attack', () => {
    const actions = commandActions(snapshot, { kind: 'team', id: 'engine-1' });
    expect(actions.find((action) => action.id === 'respond')?.commands[0]?.type).toBe('respond-to');
    expect(actions.some((action) => action.commands.some((command) => command.type === 'establish-fire-attack'))).toBe(
      true,
    );
  });
});
