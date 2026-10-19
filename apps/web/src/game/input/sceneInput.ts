import type { ObjectSnapshot } from '@emergency/protocol';
import Phaser from 'phaser';

import { sendCommand, useGameStore, type Selection } from '../../state/gameStore.ts';
import { screenToTile } from '../rendering/iso.ts';

export interface SceneHit {
  kind: 'responder' | 'object' | 'vehicle' | 'fire';
  id: string;
}

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.2;

export function bindSceneInput(
  scene: Phaser.Scene,
  hitTest: (worldX: number, worldY: number) => SceneHit | null,
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
    const hit = hitTest(world.x, world.y);
    if (pointer.button === 2) {
      if (hit?.kind === 'fire') issueFire(hit.id);
      else if (hit?.kind === 'object') issueInteraction(hit.id);
      else if (hit?.kind === 'vehicle') issueVehicle(hit.id);
      else issueMove(screenToTile(world.x, world.y));
      return;
    }
    if (pointer.button !== 0) return;

    if (hit?.kind === 'fire') useGameStore.getState().selectFire(hit.id);
    else if (hit?.kind === 'object') useGameStore.getState().selectObject(hit.id);
    else if (hit?.kind === 'vehicle') useGameStore.getState().selectVehicle(hit.id);
    else if (hit?.kind === 'responder') useGameStore.getState().selectResponder(hit.id);
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

function issueVehicle(vehicleId: string): void {
  const { selection, snapshot } = useGameStore.getState();
  if (selection?.kind === 'team' && snapshot) {
    sendCommand({ type: 'board-team', teamId: selection.id, vehicleId });
    return;
  }
  if (selection?.kind === 'responder') {
    const aboard = snapshot?.entities.find((entity) => entity.id === selection.id)?.aboardVehicleId;
    sendCommand(
      aboard === vehicleId
        ? { type: 'exit-vehicle', responderId: selection.id, vehicleId }
        : { type: 'board-vehicle', responderId: selection.id, vehicleId },
    );
    return;
  }
  useGameStore.getState().selectVehicle(vehicleId);
}

function issueFire(fireId: string): void {
  const { selection, snapshot } = useGameStore.getState();
  if (selection?.kind === 'team' && snapshot) {
    const incident = snapshot.incidents.find(
      (candidate) =>
        candidate.state === 'active' &&
        candidate.objectives.some((objective) => objective.targetId === fireId),
    );
    if (incident) {
      sendCommand({ type: 'suppress-incident', teamId: selection.id, incidentId: incident.id });
      return;
    }
  }
  if (selection?.kind === 'responder') {
    sendCommand({ type: 'suppress-fire', responderId: selection.id, fireId });
    return;
  }
  useGameStore.getState().selectFire(fireId);
}

function issueInteraction(objectId: string): void {
  const { selection, snapshot } = useGameStore.getState();
  const object = snapshot?.objects.find((candidate) => candidate.id === objectId);
  if (!object) return;
  const command = commandFor(selection, object);
  if (command) sendCommand(command);
  else useGameStore.getState().selectObject(objectId);
}

export function commandFor(selection: Selection, object: ObjectSnapshot) {
  if (selection?.kind === 'team' && object.objectType === 'locker') {
    return { type: 'retrieve-team' as const, teamId: selection.id, lockerId: object.id };
  }
  if (selection?.kind !== 'responder') return null;
  if (object.objectType === 'door') {
    return { type: 'force-door' as const, responderId: selection.id, doorId: object.id };
  }
  if (object.objectType === 'panel') {
    return { type: 'operate-panel' as const, responderId: selection.id, panelId: object.id };
  }
  const item = object.contents.find((content) => !content.reserved) ?? object.contents[0];
  if (!item) return null;
  return {
    type: 'retrieve-equipment' as const,
    responderId: selection.id,
    lockerId: object.id,
    definitionId: item.definitionId,
  };
}

function issueMove(destination: { x: number; y: number }): void {
  const selection = useGameStore.getState().selection;
  if (selection?.kind === 'responder') {
    sendCommand({ type: 'move-responder', responderId: selection.id, destination });
    return;
  }
  if (selection?.kind === 'team') {
    sendCommand({ type: 'move-team', teamId: selection.id, destination });
  }
}
