import type { Vec2 } from '@emergency/protocol';

export type HoseKind = 'supply' | 'attack';
export type HoseLinkState = 'connected' | 'open';

export interface Hose {
  kind: HoseKind;
  name: string;
  definitionId: string;
  equipmentId: string;
  maxLength: number;
  route: Vec2[];
  state: HoseLinkState;
  sourceId: string | null;
  targetId: string | null;
  operatorId: string | null;
  flow: number;
}

export function hoseEntityId(equipmentId: string): string {
  return `hose-${equipmentId}`;
}
