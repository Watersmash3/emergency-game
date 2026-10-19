import Phaser from 'phaser';

import { sendCommand, useGameStore } from '../../state/gameStore.ts';
import { screenToTile } from '../rendering/iso.ts';

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.2;

export function bindSceneInput(
  scene: Phaser.Scene,
  hitTest: (worldX: number, worldY: number) => string | null,
): void {
  scene.input.mouse?.disableContextMenu();

  let panning = false;
  let panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.button === 1) {
      const camera = scene.cameras.main;
      panning = true;
      panStart = { x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY };
      return;
    }

    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (pointer.button === 2) {
      issueMove(screenToTile(world.x, world.y));
      return;
    }
    if (pointer.button !== 0) return;

    const responderId = hitTest(world.x, world.y);
    if (responderId) useGameStore.getState().selectResponder(responderId);
    else useGameStore.getState().clearSelection();
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!panning || !pointer.middleButtonDown()) return;
    const camera = scene.cameras.main;
    camera.scrollX = panStart.scrollX - (pointer.x - panStart.x) / camera.zoom;
    camera.scrollY = panStart.scrollY - (pointer.y - panStart.y) / camera.zoom;
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (pointer.button === 1) panning = false;
  });

  scene.input.on(
    'wheel',
    (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const camera = scene.cameras.main;
      const next = Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM);
      camera.setZoom(next);
    },
  );
}

function issueMove(destination: { x: number; y: number }): void {
  const selection = useGameStore.getState().selection;
  if (!selection) return;
  if (selection.kind === 'responder') {
    sendCommand({ type: 'move-responder', responderId: selection.id, destination });
    return;
  }
  sendCommand({ type: 'move-team', teamId: selection.id, destination });
}
