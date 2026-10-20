import Phaser from 'phaser';

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  drawDiamond(scene, 'tile-ground', 0x31443c, 0x24332c, 0x3d5549);
  drawDiamond(scene, 'tile-ground-alt', 0x2c3d36, 0x223028, 0x385246);
  drawDiamond(scene, 'tile-interior', 0xcbbba6, 0xb09e88, 0xd8c8b4);
  drawDiamond(scene, 'tile-interior-alt', 0xb7a894, 0x9c8c78, 0xc8b6a2);
  drawDiamond(scene, 'tile-foundation', 0x6e6258, 0x53483f, 0x7d7266);
  drawRoad(scene);
  drawWall(scene, 'wall-full', 28);
  drawWall(scene, 'wall-low', 8);
  drawRubble(scene);
  drawShadow(scene);
  const helmets = [0xf2c14e, 0xe07a3d, 0x7fcdbb, 0xf28fad];
  helmets.forEach((helmet, index) => drawFirefighter(scene, `responder-${index}`, helmet));
  drawLocker(scene);
  drawDoorSet(scene);
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

function drawWall(scene: Phaser.Scene, key: string, rise: number): void {
  const width = 64;
  const height = 80;
  const baseY = 56;
  const topY = baseY - rise;
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x3a312b, 1);
  graphics.fillTriangle(0, topY, 32, topY + 16, 32, baseY + 16);
  graphics.fillTriangle(0, topY, 32, baseY + 16, 0, baseY);
  graphics.fillStyle(0x8a7564, 1);
  graphics.fillTriangle(64, topY, 32, topY + 16, 32, baseY + 16);
  graphics.fillTriangle(64, topY, 32, baseY + 16, 64, baseY);
  graphics.fillStyle(0xc3ad98, 1);
  graphics.fillTriangle(32, topY - 16, 64, topY, 32, topY + 16);
  graphics.fillTriangle(32, topY - 16, 0, topY, 32, topY + 16);
  graphics.lineStyle(1, 0x2a241f, 0.45);
  graphics.lineBetween(32, topY + 16, 32, baseY + 16);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function drawRubble(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x102018, 0.28);
  graphics.fillEllipse(16, 28, 18, 6);
  graphics.fillStyle(0x6a6258, 1);
  graphics.fillTriangle(6, 24, 16, 10, 22, 24);
  graphics.fillStyle(0x8a8074, 1);
  graphics.fillTriangle(12, 22, 24, 12, 28, 24);
  graphics.generateTexture('prop-rubble', 32, 32);
  graphics.destroy();
}

function drawShadow(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x101418, 0.35);
  graphics.fillEllipse(16, 8, 22, 8);
  graphics.generateTexture('prop-shadow', 32, 16);
  graphics.destroy();
}

function drawFirefighter(scene: Phaser.Scene, key: string, helmet: number): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x1c2428, 1);
  graphics.fillRoundedRect(12, 30, 5, 14, 2);
  graphics.fillRoundedRect(23, 30, 5, 14, 2);
  graphics.fillStyle(0x14181c, 1);
  graphics.fillRoundedRect(11, 42, 7, 4, 1);
  graphics.fillRoundedRect(22, 42, 7, 4, 1);
  graphics.fillStyle(0x9c2e28, 1);
  graphics.fillRoundedRect(9, 16, 22, 18, 4);
  graphics.fillStyle(0xf2c14e, 1);
  graphics.fillRect(10, 24, 20, 3);
  graphics.fillStyle(0xf4f1ea, 1);
  graphics.fillRect(12, 19, 6, 4);
  graphics.fillStyle(0xc4553a, 1);
  graphics.fillRoundedRect(6, 18, 5, 12, 2);
  graphics.fillRoundedRect(29, 18, 5, 12, 2);
  graphics.fillStyle(helmet, 1);
  graphics.fillCircle(20, 11, 7);
  graphics.fillStyle(0x1c2428, 1);
  graphics.fillRect(12, 11, 16, 3);
  graphics.fillStyle(0x9ad7ff, 0.9);
  graphics.fillRect(14, 12, 12, 2);
  graphics.generateTexture(key, 40, 52);
  graphics.destroy();
}

function drawEngine(scene: Phaser.Scene): void {
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x101418, 0.28);
  graphics.fillEllipse(64, 58, 96, 16);
  graphics.fillStyle(0x8f241e, 1);
  graphics.fillRoundedRect(18, 22, 78, 26, 4);
  graphics.fillStyle(0xf2c14e, 1);
  graphics.fillRect(22, 32, 52, 5);
  graphics.fillStyle(0xd5e4f2, 1);
  graphics.fillRoundedRect(84, 24, 24, 16, 3);
  graphics.fillStyle(0x6f1c18, 1);
  graphics.fillRoundedRect(28, 14, 46, 10, 2);
  graphics.fillStyle(0x17211c, 1);
  graphics.fillCircle(36, 48, 7);
  graphics.fillCircle(78, 48, 7);
  graphics.fillStyle(0xb7b7b7, 1);
  graphics.fillCircle(36, 48, 3);
  graphics.fillCircle(78, 48, 3);
  graphics.fillStyle(0xf4f7f5, 1);
  graphics.fillCircle(96, 30, 2);
  graphics.generateTexture('vehicle-engine', 120, 72);
  graphics.destroy();
}

function drawDoorSet(scene: Phaser.Scene): void {
  for (const axis of ['x', 'y'] as const) {
    drawIsoDoor(scene, `door-${axis}-closed`, axis, 'closed');
    drawIsoDoor(scene, `door-${axis}-locked`, axis, 'locked');
    drawIsoDoor(scene, `door-${axis}-open`, axis, 'open');
    drawIsoDoor(scene, `door-${axis}-forced`, axis, 'forced');
  }
}

function drawIsoDoor(
  scene: Phaser.Scene,
  key: string,
  axis: 'x' | 'y',
  state: 'closed' | 'locked' | 'open' | 'forced',
): void {
  const graphics = scene.add.graphics();
  const leaf = state === 'forced' ? 0x8a5a3c : state === 'open' ? 0x6e8f74 : 0x6b3a32;
  const hingeX = axis === 'x' ? 18 : 46;
  graphics.fillStyle(0x2a241f, 1);
  graphics.fillRect(hingeX, 26, 4, 42);
  graphics.fillRect(axis === 'x' ? 42 : 14, 26, 4, 42);
  graphics.fillRect(axis === 'x' ? 18 : 14, 24, 28, 4);
  if (state !== 'open') {
    graphics.fillStyle(leaf, 1);
    graphics.fillRect(axis === 'x' ? 22 : 18, 28, 20, 38);
    graphics.fillStyle(0xf2c14e, 1);
    graphics.fillCircle(axis === 'x' ? 36 : 24, 48, 2);
  } else {
    graphics.fillStyle(leaf, 1);
    graphics.fillRect(axis === 'x' ? 10 : 46, 28, 8, 36);
  }
  if (state === 'locked') {
    graphics.fillStyle(0xd7d2c4, 1);
    graphics.fillRect(axis === 'x' ? 22 : 18, 46, 20, 3);
  }
  if (state === 'forced') {
    graphics.lineStyle(2, 0x1c2428, 1);
    graphics.lineBetween(axis === 'x' ? 24 : 20, 32, axis === 'x' ? 40 : 36, 60);
  }
  graphics.generateTexture(key, 64, 72);
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
  graphics.fillStyle(0x101418, 0.28);
  graphics.fillEllipse(20, 40, 28, 8);
  if (out) {
    graphics.fillStyle(0x4a433c, 1);
    graphics.fillEllipse(20, 34, 24, 8);
    graphics.fillStyle(0x6d6456, 1);
    graphics.fillTriangle(20, 18, 30, 34, 10, 34);
  } else {
    graphics.fillStyle(0xc2411a, 0.95);
    graphics.fillTriangle(20, 4, 38, 38, 2, 38);
    graphics.fillStyle(0xf26b1d, 1);
    graphics.fillTriangle(20, 14, 32, 38, 8, 38);
    graphics.fillStyle(0xf2c14e, 1);
    graphics.fillTriangle(20, 22, 28, 38, 12, 38);
    graphics.fillStyle(0xfff1c9, 1);
    graphics.fillTriangle(20, 28, 25, 38, 15, 38);
  }
  graphics.generateTexture(key, 40, 44);
  graphics.destroy();
}
