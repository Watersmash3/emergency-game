import type { Command, SimulationSnapshot, WorkerOutbound } from '@emergency/protocol';
import { create } from 'zustand';

import { mergeIds, type Selection } from '../game/input/selection.ts';
import type { RoofMode } from '../game/rendering/interior.ts';

export type { Selection };

export type CameraMode = 'fit' | 'focus';

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
  saveNotice: string | null;
  savesRevision: number;
  follow: boolean;
  debug: boolean;
  thermalView: boolean;
  savesOpen: boolean;
  settingsOpen: boolean;
  rosterOpen: boolean;
  detailOpen: boolean;
  advanced: boolean;
  commandMode: 'move' | null;
  roofMode: RoofMode;
  focusRoomId: string | null;
  cameraMode: CameraMode;
  cameraToken: number;
  layoutToken: number;
  applyOutbound: (message: WorkerOutbound) => void;
  setSaveNotice: (notice: string | null) => void;
  bumpSaves: () => void;
  selectResponders: (ids: string[], additive?: boolean, toggle?: boolean) => void;
  selectTeam: (id: string) => void;
  selectObject: (id: string) => void;
  selectVehicle: (id: string) => void;
  selectFire: (id: string) => void;
  selectHydrant: (id: string) => void;
  selectHose: (id: string) => void;
  clearSelection: () => void;
  requestCamera: (mode: CameraMode) => void;
  toggleFollow: () => void;
  toggleDebug: () => void;
  toggleThermal: () => void;
  setSavesOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleRoster: () => void;
  toggleDetail: () => void;
  toggleAdvanced: () => void;
  selectIncident: (id: string) => void;
  setCommandMode: (mode: 'move' | null) => void;
  setRoofMode: (mode: RoofMode) => void;
  setFocusRoom: (roomId: string | null) => void;
  reset: () => void;
}

const initial = {
  snapshot: null,
  previousSnapshot: null,
  snapshotAt: 0,
  selection: null as Selection,
  lastResult: null,
  error: null,
  saveNotice: null,
  savesRevision: 0,
  follow: false,
  debug: false,
  thermalView: false,
  savesOpen: false,
  settingsOpen: false,
  rosterOpen: true,
  detailOpen: true,
  advanced: false,
  commandMode: null as 'move' | null,
  roofMode: 'auto' as RoofMode,
  focusRoomId: null as string | null,
  cameraMode: 'fit' as CameraMode,
  cameraToken: 0,
  layoutToken: 0,
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
  selectResponders: (ids, additive = false, toggle = false) =>
    set((state) => {
      const current = state.selection?.kind === 'responders' ? state.selection.ids : [];
      const next = mergeIds(current, ids, additive, toggle);
      return {
        selection: next.length > 0 ? { kind: 'responders', ids: next } : null,
        commandMode: null,
      };
    }),
  selectTeam: (id) => set({ selection: { kind: 'team', id }, commandMode: null }),
  selectIncident: (id) => set({ selection: { kind: 'incident', id }, commandMode: null }),
  selectObject: (id) => set({ selection: { kind: 'object', id }, commandMode: null }),
  selectVehicle: (id) => set({ selection: { kind: 'vehicle', id }, commandMode: null }),
  selectFire: (id) => set({ selection: { kind: 'fire', id }, commandMode: null }),
  selectHydrant: (id) => set({ selection: { kind: 'hydrant', id }, commandMode: null }),
  selectHose: (id) => set({ selection: { kind: 'hose', id }, commandMode: null }),
  clearSelection: () => set({ selection: null, commandMode: null, focusRoomId: null }),
  requestCamera: (mode) =>
    set((state) => ({
      cameraMode: mode,
      cameraToken: state.cameraToken + 1,
      follow: mode === 'focus' ? state.follow : false,
    })),
  toggleFollow: () => set((state) => ({ follow: !state.follow })),
  toggleDebug: () => set((state) => ({ debug: !state.debug })),
  toggleThermal: () => set((state) => ({ thermalView: !state.thermalView })),
  setSavesOpen: (savesOpen) => set({ savesOpen, settingsOpen: false }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleRoster: () =>
    set((state) => ({ rosterOpen: !state.rosterOpen, layoutToken: state.layoutToken + 1 })),
  toggleDetail: () =>
    set((state) => ({ detailOpen: !state.detailOpen, layoutToken: state.layoutToken + 1 })),
  toggleAdvanced: () => set((state) => ({ advanced: !state.advanced })),
  setCommandMode: (commandMode) => set({ commandMode }),
  setRoofMode: (roofMode) => set({ roofMode }),
  setFocusRoom: (focusRoomId) => set({ focusRoomId }),
  setSaveNotice: (saveNotice) => set({ saveNotice }),
  bumpSaves: () => set((state) => ({ savesRevision: state.savesRevision + 1 })),
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
