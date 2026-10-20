export type CommandStrategy = 'offensive' | 'defensive' | 'hold' | 'rescue' | 'containment';

export type AutonomyPolicy = 'standard' | 'supervised' | 'manual';

export type StrategicKind = 'respond' | 'control-fire' | 'withdraw' | 'return-to-service';

export type StrategicState = 'running' | 'blocked' | 'awaiting' | 'complete' | 'cancelled';

/** A company objective. `stepOperations` is the only thing that turns one into tasks. */
export interface StrategicOrder {
  id: string;
  kind: StrategicKind;
  incidentId: string;
  companyId: string;
  priority: number;
  state: StrategicState;
  progress: string;
  blockedReason: string | null;
  decision: string | null;
  approved: boolean;
  committed: boolean;
  posted: boolean;
}

export type CommandPhase =
  | 'idle'
  | 'responding'
  | 'attacking'
  | 'searching'
  | 'defending'
  | 'withdrawing'
  | 'blocked'
  | 'complete';

export type CommandOrder = 'none' | 'respond' | 'attack' | 'search' | 'defend' | 'withdraw' | 'return';

export interface OperationPlan {
  incidentId: string;
  strategy: CommandStrategy;
  phase: CommandPhase;
  order: CommandOrder;
  blockedReason: string | null;
  buildingId: string | null;
}

export interface TacticalZone {
  id: string;
  incidentId: string;
  kind: 'staging' | 'assembly' | 'search' | 'attack' | 'exclusion' | 'withdrawal';
  x: number;
  y: number;
}

export function defaultPlan(incidentId: string): OperationPlan {
  return {
    incidentId,
    strategy: 'offensive',
    phase: 'idle',
    order: 'none',
    blockedReason: null,
    buildingId: null,
  };
}
