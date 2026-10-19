import type { TaskState, Tile } from '@emergency/protocol';

export interface MoveTask {
  id: string;
  kind: 'move';
  state: TaskState;
  assigneeId: string;
  groupId?: string;
  source: 'team' | 'individual';
  destination: Tile;
  suspendedByTaskId?: string;
  failureReason?: string;
}
