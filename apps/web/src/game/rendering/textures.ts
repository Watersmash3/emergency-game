import Phaser from 'phaser';

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  drawDiamond(scene, 'tile-ground', 0x31443c, 0x24332c, 0x3d5549);
  drawDiamond(scene, 'tile-ground-alt', 0x2c3d36, 0x223028, 0x385246);
  drawRoad(scene);
  drawStructure(scene);
  const helmets = [0xf2c14e, 0xe07a3d, 0x7fcdbb, 0xf28fad];
  helmets.forEach((helmet, index) => drawFirefighter(scene, `responder-${index}`, helmet));
  drawLocker(scene);
  drawDoor(scene, 'object-door', 0x8d3b32);
  drawDoor(scene, 'object-door-open', 0x2f6b45);
  drawPanel(scene, 'object-panel', 0x1d4c4a);
  drawPanel(scene, 'object-panel-on', 0x2f8f6b);
  drawHydrant(scene);
  drawEngine(scene);
  drawFire(scene, 'fire-live', false);
  drawFire(scene, 'fire-out', true);
}

function drawDiamond(
  scene: Phaser.Scene,
  key: string,
  top: number,
  left: number,
  right: number,
): void {
  const graphics = scene.add.graphics();
  const midX = TILE_WIDTH / 2;
  const midY = TILE_HEIGHT / 2;
  graphics.fillStyle(top, 1);
  graphics.beginPath();
  graphics.moveTo(midX, 0);
  graphics.lineTo(TILE_WIDTH, midY);
  graphics.lineTo(midX, TILE_HEIGHT);
  graphics.lineTo(0, midY);
  graphics.closePath();
  graphics.fillPath();
  graphics.fillStyle(left, 1);
  graphics.fillTriangle(0, midY, midX, TILE_HEIGHT, midX, midY);
  graphics.fillStyle(right, 1);
  graphics.fillTriangle(TILE_WIDTH, midY, midX, TILE_HEIGHT, midX, midY);
  graphics.lineStyle(1, 0x17211c, 0.45);
  graphics.strokePath();
  graphics.generateTexture(key, TILE_WIDTH, TILE_HEIGHT);
  graphics.destroy();
}

function drawRoad(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  const midX = TILE_WIDTH / 2;
  const midY = TILE_HEIGHT / 2;
  graphics.fillStyle(0x4e5560, 1);
  graphics.beginPath();
  graphics.moveTo(midX, 0);
  graphics.lineTo(TILE_WIDTH, midY);
  graphics.lineTo(midX, TILE_HEIGHT);
  graphics.lineTo(0, midY);
  graphics.closePath();
  graphics.fillPath();
  graphics.lineStyle(2, 0xd7d2c4, 0.8);
  graphics.lineBetween(midX, 6, midX, TILE_HEIGHT - 6);
  graphics.generateTexture('tile-road', TILE_WIDTH, TILE_HEIGHT);
  graphics.destroy();
}

function drawStructure(scene: Phaser.Scene): void {
  const width = 64;
  const height = 52;
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x2a241f, 0.35);
  graphics.fillEllipse(32, 46, 46, 14);
  graphics.fillStyle(0x6a5a4e, 1);
  graphics.fillTriangle(32, 8, 58, 24, 32, 40);
  graphics.fillStyle(0x3d342c, 1);
  graphics.fillTriangle(6, 24, 32, 40, 32, 24);
  graphics.fillStyle(0x514539, 1);
  graphics.fillTriangle(58, 24, 32, 40, 32, 24);
  graphics.fillStyle(0x8d6b4a, 1);
  graphics.fillRect(28, 30, 8, 10);
  graphics.generateTexture('tile-structure', width, height);
  graphics.destroy();
}

function drawFirefighter(scene: Phaser.Scene, key: string, helmet: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x102018, 0.35);
  graphics.fillEllipse(16, 30, 16, 6);
  graphics.fillStyle(0x1e2428, 1);
  graphics.fillRect(11, 18, 4, 10);
  graphics.fillRect(17, 18, 4, 10);
  graphics.fillStyle(0xb4332a, 1);
  graphics.fillRoundedRect(8, 12, 16, 12, 3);
  graphics.fillStyle(0xf4f7f5, 1);
  graphics.fillRect(10, 15, 5, 3);
  graphics.fillStyle(helmet, 1);
  graphics.fillCircle(16, 10, 6);
  graphics.fillStyle(0x17211c, 1);
  graphics.fillRect(10, 9, 12, 2);
  graphics.generateTexture(key, 32, 36);
  graphics.destroy();
}

function drawEngine(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x102018, 0.35);
  graphics.fillEllipse(48, 52, 70, 16);
  graphics.fillStyle(0xb4332a, 1);
  graphics.fillRoundedRect(12, 24, 58, 20, 3);
  graphics.fillStyle(0xf2c14e, 1);
  graphics.fillRect(14, 32, 40, 4);
  graphics.fillStyle(0xd7e7f5, 1);
  graphics.fillRoundedRect(58, 26, 18, 14, 2);
  graphics.fillStyle(0x17211c, 1);
  graphics.fillCircle(28, 44, 5);
  graphics.fillCircle(62, 44, 5);
  graphics.fillStyle(0x8d8d8d, 1);
  graphics.fillCircle(28, 44, 2);
  graphics.fillCircle(62, 44, 2);
  graphics.generateTexture('vehicle-engine', 96, 64);
  graphics.destroy();
}

function drawHydrant(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x102018, 0.3);
  graphics.fillEllipse(16, 30, 14, 5);
  graphics.fillStyle(0x3d7ec9, 1);
  graphics.fillRoundedRect(11, 10, 10, 18, 2);
  graphics.fillRect(4, 14, 7, 4);
  graphics.fillRect(21, 14, 7, 4);
  graphics.fillStyle(0xc5d7e8, 1);
  graphics.fillCircle(16, 9, 3);
  graphics.generateTexture('object-hydrant', 32, 36);
  graphics.destroy();
}

function drawLocker(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0xc9a15b, 1);
  graphics.fillRoundedRect(6, 4, 20, 26, 2);
  graphics.lineStyle(2, 0x17211c, 1);
  graphics.strokeRoundedRect(6, 4, 20, 26, 2);
  graphics.lineBetween(16, 4, 16, 30);
  graphics.fillStyle(0x17211c, 1);
  graphics.fillCircle(13, 16, 1.5);
  graphics.fillCircle(19, 16, 1.5);
  graphics.generateTexture('object-locker', 32, 36);
  graphics.destroy();
}

function drawDoor(scene: Phaser.Scene, key: string, color: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(color, 1);
  graphics.fillRoundedRect(8, 4, 16, 26, 2);
  graphics.fillStyle(0xf2c14e, 1);
  graphics.fillCircle(20, 18, 2);
  graphics.generateTexture(key, 32, 36);
  graphics.destroy();
}

function drawPanel(scene: Phaser.Scene, key: string, light: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x24312c, 1);
  graphics.fillRoundedRect(4, 8, 24, 18, 2);
  graphics.fillStyle(light, 1);
  graphics.fillCircle(12, 17, 3);
  graphics.fillCircle(20, 17, 3);
  graphics.generateTexture(key, 32, 36);
  graphics.destroy();
}

function drawFire(scene: Phaser.Scene, key: string, out: boolean): void {
  const graphics = scene.add.graphics();
  if (out) {
    graphics.fillStyle(0x3c342c, 0.9);
    graphics.fillEllipse(18, 28, 22, 8);
    graphics.fillStyle(0x6d6456, 1);
    graphics.fillTriangle(18, 14, 26, 28, 10, 28);
  } else {
    graphics.fillStyle(0xf2c14e, 0.95);
    graphics.fillTriangle(18, 2, 34, 32, 2, 32);
    graphics.fillStyle(0xf26b1d, 1);
    graphics.fillTriangle(18, 12, 28, 32, 8, 32);
    graphics.fillStyle(0xfff1c9, 1);
    graphics.fillTriangle(18, 18, 24, 32, 12, 32);
  }
  graphics.generateTexture(key, 36, 36);
  graphics.destroy();
}
