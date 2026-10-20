import { trainingYard } from '@emergency/content';
import { createSimulation } from '@emergency/simulation';
import { describe, expect, it } from 'vitest';

import { commandActions, strategicActions } from './commands.ts';

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
    expect(actions.find((action) => action.id === 'respond')?.commands[0]?.type).toBe('respond-to-incident');
    expect(actions.some((action) => action.commands.some((command) => command.type === 'suppress-structure-fire'))).toBe(
      true,
    );
  });

  it('offers one control-fire order for the incident', () => {
    const actions = strategicActions(snapshot, { kind: 'incident', id: 'incident-training' });
    expect(actions.find((action) => action.id === 'assign')?.commands[0]?.type).toBe('assign-company');
    expect(actions.find((action) => action.id === 'control-fire')?.enabled).toBe(false);
    const assigned = {
      ...snapshot,
      command: {
        ...snapshot.command,
        company: { ...snapshot.command.company, incidentId: 'incident-training' },
      },
    };
    const next = strategicActions(assigned, { kind: 'incident', id: 'incident-training' });
    expect(next.find((action) => action.id === 'control-fire')?.enabled).toBe(true);
    expect(next.find((action) => action.id === 'control-fire')?.commands[0]?.type).toBe('control-fire');
  });
});
