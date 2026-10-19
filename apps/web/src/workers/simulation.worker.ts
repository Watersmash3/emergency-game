import { workerInboundSchema, workerOutboundSchema } from '@emergency/protocol';
import { FIXED_DT_MS } from '@emergency/protocol';
import { createSimulation, restoreSimulation, type Simulation } from '@emergency/simulation';

import { shouldAutosave } from './autosavePolicy.ts';

const AUTOSAVE_INTERVAL = 100;

let simulation: Simulation | null = null;
let sessionStarted = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFrame = 0;

function post(message: unknown): void {
  const parsed = workerOutboundSchema.safeParse(message);
  if (!parsed.success) {
    self.postMessage({ type: 'error', message: 'Simulation produced an invalid snapshot.' });
    return;
  }
  self.postMessage(parsed.data);
}

function publishSnapshot(): void {
  if (!simulation) return;
  post({ type: 'snapshot', snapshot: simulation.getSnapshot() });
}

function loop(): void {
  if (!simulation) return;
  const now = performance.now();
  const elapsed = now - lastFrame;
  lastFrame = now;
  const before = simulation.currentTick();
  if (simulation.step(elapsed) > 0) {
    const after = simulation.currentTick();
    if (shouldAutosave(sessionStarted, before, after, AUTOSAVE_INTERVAL)) {
      post({ type: 'autosave', document: simulation.exportSave() });
    }
    publishSnapshot();
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = workerInboundSchema.safeParse(event.data);
  if (!parsed.success) {
    post({ type: 'error', message: 'The simulation rejected an invalid message.' });
    return;
  }

  if (parsed.data.type === 'init') {
    simulation = createSimulation(parsed.data.scenario);
    sessionStarted = false;
    lastFrame = performance.now();
    if (timer !== null) clearInterval(timer);
    timer = setInterval(loop, FIXED_DT_MS);
    post({ type: 'ready' });
    publishSnapshot();
    return;
  }

  if (parsed.data.type === 'export') {
    if (!simulation) {
      post({ type: 'error', message: 'Simulation is not ready.' });
      return;
    }
    post({
      type: 'save-document',
      requestId: parsed.data.requestId,
      document: simulation.exportSave(),
    });
    return;
  }

  if (parsed.data.type === 'restore') {
    const restored = restoreSimulation(parsed.data.document);
    if (!restored.ok) {
      post({
        type: 'restore-result',
        requestId: parsed.data.requestId,
        ok: false,
        message: restored.message,
      });
      return;
    }
    simulation = restored.simulation;
    sessionStarted = true;
    lastFrame = performance.now();
    post({ type: 'restore-result', requestId: parsed.data.requestId, ok: true });
    publishSnapshot();
    return;
  }

  if (!simulation || parsed.data.type !== 'command') {
    post({
      type: 'command-result',
      commandId: parsed.data.type === 'command' ? parsed.data.commandId : 'command',
      ok: false,
      reason: 'Simulation is not ready',
    });
    return;
  }

  const result = simulation.apply(parsed.data.command);
  if (result.ok) sessionStarted = true;
  post({
    type: 'command-result',
    commandId: parsed.data.commandId,
    ok: result.ok,
    ...(result.ok ? {} : { reason: result.reason }),
  });
  publishSnapshot();
};
