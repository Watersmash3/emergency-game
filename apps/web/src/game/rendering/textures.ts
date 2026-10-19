import Phaser from 'phaser';

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  drawDiamond(scene, 'tile-ground', 0x3e5248, 0x24312c);
  drawDiamond(scene, 'tile-blocked', 0x5a4b40, 0x2c241f);
  const colors = [0xf2c14e, 0xe07a3d, 0x7fcdbb, 0xf28fad];
  colors.forEach((color, index) => {
    drawToken(scene, `responder-${index}`, color);
  });
}

function drawDiamond(scene: Phaser.Scene, key: string, fill: number, stroke: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(fill, 1);
  graphics.lineStyle(1, stroke, 1);
  graphics.beginPath();
  graphics.moveTo(TILE_WIDTH / 2, 0);
  graphics.lineTo(TILE_WIDTH, TILE_HEIGHT / 2);
  graphics.lineTo(TILE_WIDTH / 2, TILE_HEIGHT);
  graphics.lineTo(0, TILE_HEIGHT / 2);
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
  graphics.generateTexture(key, TILE_WIDTH, TILE_HEIGHT);
  graphics.destroy();
}

function drawToken(scene: Phaser.Scene, key: string, color: number): void {
  const size = 32;
  const graphics = scene.add.graphics();
  graphics.fillStyle(color, 1);
  graphics.fillCircle(size / 2, size / 2, 11);
  graphics.lineStyle(3, 0x17211c, 1);
  graphics.strokeCircle(size / 2, size / 2, 11);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}
