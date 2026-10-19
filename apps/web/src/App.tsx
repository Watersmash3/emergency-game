import { trainingYard } from '@emergency/content';
import { useEffect } from 'react';

import { GameViewport } from './ui/GameViewport.tsx';
import { Hud } from './ui/Hud.tsx';
import { startSimulation } from './workers/simulationClient.ts';

export function App() {
  useEffect(() => startSimulation(trainingYard), []);

  return (
    <div className="shell" onContextMenu={(event) => event.preventDefault()}>
      <GameViewport />
      <Hud />
    </div>
  );
}
