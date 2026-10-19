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
  action: 'take' | 'force' | 'operate' | 'board' | 'exit';
  step: 'interact';
  progressTicks: number;
  durationTicks: number;
}

export interface BoardVehicleTask extends ActivityTask {
  kind: 'board-vehicle';
}

export interface ExitVehicleTask extends ActivityTask {
  kind: 'exit-vehicle';
}

export interface DriveVehicleTask extends ActivityTask {
  kind: 'drive-vehicle';
  destinationNodeId: string;
  nodeIds: string[];
  pathIndex: number;
}

export interface RespondTask extends ActivityTask {
  kind: 'respond';
  destinationNodeId: string;
  disembark: boolean;
}

export interface SuppressFireTask extends ActivityTask {
  kind: 'suppress-fire';
  equipmentId?: string;
}

export interface SuppressIncidentTask extends ActivityTask {
  kind: 'suppress-incident';
}

export type WaterKind =
  | 'connect-supply'
  | 'disconnect-supply'
  | 'open-supply'
  | 'close-supply'
  | 'start-pump'
  | 'stop-pump'
  | 'deploy-attack'
  | 'operate-nozzle'
  | 'reposition-nozzle'
  | 'disconnect-attack'
  | 'establish-fire-attack';

export interface WaterTask extends ActivityTask {
  kind: WaterKind;
  equipmentId?: string;
  vehicleId?: string;
  hydrantId?: string;
  hoseEntityId?: string;
  destination?: Tile;
  role?: 'supply' | 'pump' | 'attack';
}

export type ParentTask =
  | RetrieveEquipmentTask
  | ForceDoorTask
  | OperatePanelTask
  | BoardVehicleTask
  | ExitVehicleTask
  | DriveVehicleTask
  | RespondTask
  | SuppressFireTask
  | SuppressIncidentTask
  | WaterTask;

export type Task = MoveTask | ParentTask | InteractTask;

const WATER_KINDS: ReadonlySet<string> = new Set<WaterKind>([
  'connect-supply',
  'disconnect-supply',
  'open-supply',
  'close-supply',
  'start-pump',
  'stop-pump',
  'deploy-attack',
  'operate-nozzle',
  'reposition-nozzle',
  'disconnect-attack',
  'establish-fire-attack',
]);

export function isWaterTask(task: { kind: string }): task is WaterTask {
  return WATER_KINDS.has(task.kind);
}

export function isParentTask(task: Task): task is ParentTask {
  return (
    task.kind === 'retrieve-equipment' ||
    task.kind === 'force-door' ||
    task.kind === 'operate-panel' ||
    task.kind === 'board-vehicle' ||
    task.kind === 'exit-vehicle' ||
    task.kind === 'drive-vehicle' ||
    task.kind === 'respond' ||
    task.kind === 'suppress-fire' ||
    task.kind === 'suppress-incident' ||
    task.kind === 'connect-supply' ||
    task.kind === 'disconnect-supply' ||
    task.kind === 'open-supply' ||
    task.kind === 'close-supply' ||
    task.kind === 'start-pump' ||
    task.kind === 'stop-pump' ||
    task.kind === 'deploy-attack' ||
    task.kind === 'operate-nozzle' ||
    task.kind === 'reposition-nozzle' ||
    task.kind === 'disconnect-attack' ||
    task.kind === 'establish-fire-attack'
  );
}
