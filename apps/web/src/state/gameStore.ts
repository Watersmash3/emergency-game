import type { Command, SimulationSnapshot, WorkerOutbound } from '@emergency/protocol';
import { create } from 'zustand';

export type Selection =
  | { kind: 'responder'; id: string }
  | { kind: 'team'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'vehicle'; id: string }
  | null;

export interface CommandResultView {
  commandId: string;
  ok: boolean;
  reason?: string;
}

interface GameState {
  snapshot: SimulationSnapshot | null;
  previousSnapshot: SimulationSnapshot | null;
  snapshotAt: number;
  selection: Selection;
  lastResult: CommandResultView | null;
  error: string | null;
  applyOutbound: (message: WorkerOutbound) => void;
  selectResponder: (id: string) => void;
  selectTeam: (id: string) => void;
  selectObject: (id: string) => void;
  selectVehicle: (id: string) => void;
  clearSelection: () => void;
  reset: () => void;
}

const initial = {
  snapshot: null,
  previousSnapshot: null,
  snapshotAt: 0,
  selection: null,
  lastResult: null,
  error: null,
};

export const useGameStore = create<GameState>((set) => ({
  ...initial,
  applyOutbound: (message) => {
    if (message.type === 'snapshot') {
      set((state) => ({
        previousSnapshot: state.snapshot,
        snapshot: message.snapshot,
        snapshotAt: performance.now(),
        error: null,
      }));
      return;
    }
    if (message.type === 'command-result') {
      set({
        lastResult: {
          commandId: message.commandId,
          ok: message.ok,
          ...(message.reason ? { reason: message.reason } : {}),
        },
      });
      return;
    }
    if (message.type === 'error') set({ error: message.message });
  },
  selectResponder: (id) => set({ selection: { kind: 'responder', id } }),
  selectTeam: (id) => set({ selection: { kind: 'team', id } }),
  selectObject: (id) => set({ selection: { kind: 'object', id } }),
  selectVehicle: (id) => set({ selection: { kind: 'vehicle', id } }),
  clearSelection: () => set({ selection: null }),
  reset: () => set(initial),
}));

const noopSend = (): void => {};
let sendImpl: (command: Command) => void = noopSend;

export function setCommandSender(send: (command: Command) => void): void {
  sendImpl = send;
}

export function clearCommandSender(): void {
  sendImpl = noopSend;
}

export function sendCommand(command: Command): void {
  sendImpl(command);
}
