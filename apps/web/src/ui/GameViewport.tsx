import { useEffect, useRef } from 'react';

import { createPhaserGame } from '../game/phaserGame.ts';

export function GameViewport() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const game = createPhaserGame(host);
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div ref={hostRef} className="viewport" />;
}
