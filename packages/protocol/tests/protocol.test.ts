import { describe, expect, it } from 'vitest';

import { commandSchema, scenarioSchema, workerInboundSchema } from '../src/index.ts';

describe('protocol schemas', () => {
  it('accepts a move command and rejects an unknown command', () => {
    expect(
      commandSchema.safeParse({
        type: 'move-responder',
        responderId: 'ff-hayes',
        destination: { x: 4, y: 2 },
      }).success,
    ).toBe(true);

    expect(commandSchema.safeParse({ type: 'extinguish' }).success).toBe(false);
    expect(
      commandSchema.safeParse({
        type: 'force-door',
        responderId: 'ff-hayes',
        doorId: 'door-training',
      }).success,
    ).toBe(true);
  });

  it('rejects a scenario with no responders', () => {
    const result = scenarioSchema.safeParse({
      id: 'empty',
      name: 'Empty',
      seed: 1,
      width: 4,
      height: 4,
      blocked: [],
      team: { id: 'engine-1', name: 'Engine 1', memberIds: ['missing'] },
      responders: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a worker message with a malformed command', () => {
    const result = workerInboundSchema.safeParse({
      type: 'command',
      commandId: 'cmd-1',
      command: { type: 'move-team', teamId: 'engine-1' },
    });

    expect(result.success).toBe(false);
  });
});
