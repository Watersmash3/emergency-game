export type PumpState = 'off' | 'starting' | 'operating' | 'unavailable';

export interface Pump {
  state: PumpState;
  pressure: number;
  maxDelivery: number;
  tankCapacity: number;
  tank: number;
  intakeId: string | null;
  discharges: string[];
  /** Water already sent to attack lines during the current tick. */
  delivered: number;
}
