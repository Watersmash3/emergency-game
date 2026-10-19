import Phaser from 'phaser';

import { canvasSize } from './rendering/camera.ts';
import { IsometricScene } from './scenes/IsometricScene.ts';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  const size = canvasSize(parent.clientWidth, parent.clientHeight);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#101418',
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: size.width,
      height: size.height,
    },
    scene: [IsometricScene],
  });
}
