import type { Scenario } from '@emergency/protocol';
import { workerOutboundSchema } from '@emergency/protocol';

import { clearCommandSender, setCommandSender, useGameStore } from '../state/gameStore.ts';

let commandSeq = 0;
let clientGeneration = 0;

export function startSimulation(scenario: Scenario): () => void {
  const generation = ++clientGeneration;
  const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });

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
    if (generation !== clientGeneration) return;
    clearCommandSender();
    useGameStore.getState().reset();
  };
}
