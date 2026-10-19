import type { TaskState } from '@emergency/protocol';

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  pending: ['ready', 'failed', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['suspended', 'completed', 'failed', 'cancelled'],
  suspended: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(task: { state: TaskState }, to: TaskState): void {
  if (!canTransition(task.state, to)) {
    throw new Error(`Invalid task transition ${task.state} -> ${to}`);
  }
  task.state = to;
}
