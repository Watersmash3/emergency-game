import type { TaskState, Tile } from '@emergency/protocol';

interface TaskCommon {
  id: string;
  state: TaskState;
  assigneeId: string;
  groupId?: string;
  source: 'team' | 'individual';
  suspendedByTaskId?: string;
  failureReason?: string;
  parentId?: string;
  reservations: string[];
}

export interface MoveTask extends TaskCommon {
  kind: 'move';
  destination: Tile;
}

interface ActivityTask extends TaskCommon {
  targetId: string;
  step: string;
  childTaskId?: string;
  approachTile?: Tile;
  progressTicks: number;
  durationTicks: number;
}

export interface RetrieveEquipmentTask extends ActivityTask {
  kind: 'retrieve-equipment';
  definitionId: string;
  equipmentId?: string;
}

export interface ForceDoorTask extends ActivityTask {
  kind: 'force-door';
}

export interface OperatePanelTask extends ActivityTask {
  kind: 'operate-panel';
}

export interface InteractTask extends TaskCommon {
  kind: 'interact';
  targetId: string;
  action: 'take' | 'force' | 'operate';
  step: 'interact';
  progressTicks: number;
  durationTicks: number;
}

export type ParentTask = RetrieveEquipmentTask | ForceDoorTask | OperatePanelTask;

export type Task = MoveTask | ParentTask | InteractTask;

export function isParentTask(task: Task): task is ParentTask {
  return (
    task.kind === 'retrieve-equipment' ||
    task.kind === 'force-door' ||
    task.kind === 'operate-panel'
  );
}
