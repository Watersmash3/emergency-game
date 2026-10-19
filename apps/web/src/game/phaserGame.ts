import Phaser from 'phaser';

import { IsometricScene } from './scenes/IsometricScene.ts';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#121816',
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.max(parent.clientWidth, 640),
      height: Math.max(parent.clientHeight, 480),
    },
    scene: [IsometricScene],
  });
}
