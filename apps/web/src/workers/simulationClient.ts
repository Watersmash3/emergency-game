import type { SaveDocument, Scenario } from '@emergency/protocol';
import { workerOutboundSchema } from '@emergency/protocol';

import { describeStorageError, writeAutosave } from '../persistence/saves.ts';
import { clearCommandSender, setCommandSender, useGameStore } from '../state/gameStore.ts';

let commandSeq = 0;
let clientGeneration = 0;

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type RestoreOutcome = { ok: true } | { ok: false; message: string };

interface PersistenceBridge {
  exportDocument: () => Promise<SaveDocument>;
  restoreDocument: (document: SaveDocument) => Promise<RestoreOutcome>;
}

let persistenceBridge: PersistenceBridge | null = null;

export function exportDocument(): Promise<SaveDocument> {
  if (!persistenceBridge) return Promise.reject(new Error('Simulation is not ready.'));
  return persistenceBridge.exportDocument();
}

export function restoreDocument(document: SaveDocument): Promise<RestoreOutcome> {
  if (!persistenceBridge) return Promise.reject(new Error('Simulation is not ready.'));
  return persistenceBridge.restoreDocument(document);
}

export function startSimulation(scenario: Scenario): () => void {
  const generation = ++clientGeneration;
  const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
  const pendingExport = new Map<string, Pending<SaveDocument>>();
  const pendingRestore = new Map<string, Pending<RestoreOutcome>>();

  const rejectPending = (message: string) => {
    for (const pending of pendingExport.values()) pending.reject(new Error(message));
    for (const pending of pendingRestore.values()) pending.reject(new Error(message));
    pendingExport.clear();
    pendingRestore.clear();
  };

  persistenceBridge = {
    exportDocument: () =>
      new Promise((resolve, reject) => {
        if (generation !== clientGeneration) {
          reject(new Error('Simulation is not ready.'));
          return;
        }
        const requestId = `export-${++commandSeq}`;
        pendingExport.set(requestId, { resolve, reject });
        worker.postMessage({ type: 'export', requestId });
      }),
    restoreDocument: (document) =>
      new Promise((resolve, reject) => {
        if (generation !== clientGeneration) {
          reject(new Error('Simulation is not ready.'));
          return;
        }
        const requestId = `restore-${++commandSeq}`;
        pendingRestore.set(requestId, { resolve, reject });
        worker.postMessage({ type: 'restore', requestId, document });
      }),
  };

  setCommandSender((command) => {
    if (generation !== clientGeneration) return;
    commandSeq += 1;
    worker.postMessage({ type: 'command', commandId: `cmd-${commandSeq}`, command });
  });

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (generation !== clientGeneration) return;
    const parsed = workerOutboundSchema.safeParse(event.data);
    if (!parsed.success) {
      useGameStore.getState().applyOutbound({
        type: 'error',
        message: 'Received an invalid simulation message.',
      });
      return;
    }
    if (parsed.data.type === 'save-document') {
      const pending = pendingExport.get(parsed.data.requestId);
      pendingExport.delete(parsed.data.requestId);
      pending?.resolve(parsed.data.document);
      return;
    }
    if (parsed.data.type === 'restore-result') {
      const pending = pendingRestore.get(parsed.data.requestId);
      pendingRestore.delete(parsed.data.requestId);
      if (parsed.data.ok) pending?.resolve({ ok: true });
      else
        pending?.resolve({
          ok: false,
          message: parsed.data.message ?? 'This save is invalid or incomplete.',
        });
      return;
    }
    if (parsed.data.type === 'autosave') {
      writeAutosave(parsed.data.document).then(
        () => useGameStore.getState().bumpSaves(),
        (error: unknown) => useGameStore.getState().setSaveNotice(describeStorageError(error)),
      );
      return;
    }
    if (parsed.data.type === 'error') rejectPending(parsed.data.message);
    useGameStore.getState().applyOutbound(parsed.data);
  };

  worker.onerror = () => {
    if (generation !== clientGeneration) return;
    useGameStore.getState().applyOutbound({
      type: 'error',
      message: 'The simulation worker stopped.',
    });
  };

  worker.postMessage({ type: 'init', scenario });

  return () => {
    worker.terminate();
    rejectPending('Simulation is not ready.');
    if (generation !== clientGeneration) return;
    persistenceBridge = null;
    clearCommandSender();
    useGameStore.getState().reset();
  };
}
