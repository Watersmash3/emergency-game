import { workerInboundSchema, workerOutboundSchema } from '@emergency/protocol';
import { FIXED_DT_MS } from '@emergency/protocol';
import { createSimulation, type Simulation } from '@emergency/simulation';

let simulation: Simulation | null = null;
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
  if (simulation.step(elapsed) > 0) publishSnapshot();
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = workerInboundSchema.safeParse(event.data);
  if (!parsed.success) {
    post({ type: 'error', message: 'The simulation rejected an invalid message.' });
    return;
  }

  if (parsed.data.type === 'init') {
    simulation = createSimulation(parsed.data.scenario);
    lastFrame = performance.now();
    if (timer !== null) clearInterval(timer);
    timer = setInterval(loop, FIXED_DT_MS);
    post({ type: 'ready' });
    publishSnapshot();
    return;
  }

  if (!simulation) {
    post({
      type: 'command-result',
      commandId: parsed.data.commandId,
      ok: false,
      reason: 'Simulation is not ready',
    });
    return;
  }

  const result = simulation.apply(parsed.data.command);
  post({
    type: 'command-result',
    commandId: parsed.data.commandId,
    ok: result.ok,
    ...(result.ok ? {} : { reason: result.reason }),
  });
  publishSnapshot();
};
