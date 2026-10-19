import { describe, expect, it } from 'vitest';

import type { TaskState } from '@emergency/protocol';

import { canTransition } from '../src/index.ts';

const STATES: TaskState[] = [
  'pending',
  'ready',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled',
];

describe('task transitions', () => {
  it('allows the move-order lifecycle and rejects terminal changes', () => {
    expect(canTransition('pending', 'ready')).toBe(true);
    expect(canTransition('ready', 'running')).toBe(true);
    expect(canTransition('running', 'suspended')).toBe(true);
    expect(canTransition('suspended', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'cancelled')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);

    for (const state of STATES) {
      expect(canTransition('completed', state)).toBe(false);
      expect(canTransition('failed', state)).toBe(false);
      expect(canTransition('cancelled', state)).toBe(false);
    }

    expect(canTransition('pending', 'running')).toBe(false);
    expect(canTransition('suspended', 'completed')).toBe(false);
  });
});
