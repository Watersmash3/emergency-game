import type { Command, ObjectSnapshot, QueuedCommand } from '@emergency/protocol';
import Phaser from 'phaser';

import { sendCommand, useGameStore } from '../../state/gameStore.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../rendering/camera.ts';
import { screenToTile } from '../rendering/iso.ts';
import {
  soleResponder,
  type ScreenRect,
  type Selection,
} from './selection.ts';

export interface SceneHit {
  kind: 'responder' | 'object' | 'vehicle' | 'fire' | 'hydrant' | 'hose';
  id: string;
}

interface Drag {
  x: number;
  y: number;
  additive: boolean;
  moved: boolean;
}

export function bindSceneInput(
  scene: Phaser.Scene,
  hooks: {
    hitTest: (worldX: number, worldY: number) => SceneHit | null;
    respondersInRect: (rect: ScreenRect) => string[];
    setMarquee: (rect: ScreenRect | null) => void;
    onHover: (hit: SceneHit | null) => void;
    onUserCamera: () => void;
  },
): void {
  scene.input.mouse?.disableContextMenu();

  let panning = false;
  let drag: Drag | null = null;
  let panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.button === 1) {
      const camera = scene.cameras.main;
      panning = true;
      hooks.onUserCamera();
      panStart = { x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY };
      return;
    }

    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hit = hooks.hitTest(world.x, world.y);
    if (pointer.button === 2) {
      const queue = shiftKey(pointer);
      if (hit?.kind === 'fire') issueFire(hit.id);
      else if (hit?.kind === 'hydrant') issueHydrant(hit.id);
      else if (hit?.kind === 'object') issueInteraction(hit.id, queue);
      else if (hit?.kind === 'vehicle') issueVehicle(hit.id, queue);
      else issueMove(screenToTile(world.x, world.y), queue);
      useGameStore.getState().setCommandMode(null);
      return;
    }
    if (pointer.button !== 0) return;
    drag = { x: pointer.x, y: pointer.y, additive: modifier(pointer), moved: false };
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (panning && pointer.middleButtonDown()) {
      const camera = scene.cameras.main;
      camera.scrollX = panStart.scrollX - (pointer.x - panStart.x) / camera.zoom;
      camera.scrollY = panStart.scrollY - (pointer.y - panStart.y) / camera.zoom;
      return;
    }
    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    hooks.onHover(hooks.hitTest(world.x, world.y));
    if (!drag) return;
    if (Math.hypot(pointer.x - drag.x, pointer.y - drag.y) < 8) return;
    drag.moved = true;
    hooks.setMarquee({ left: drag.x, top: drag.y, right: pointer.x, bottom: pointer.y });
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (pointer.button === 1) {
      panning = false;
      return;
    }
    if (pointer.button !== 0 || !drag) return;
    const active = drag;
    drag = null;
    hooks.setMarquee(null);
    if (active.moved) {
      const ids = hooks.respondersInRect({
        left: active.x,
        top: active.y,
        right: pointer.x,
        bottom: pointer.y,
      });
      useGameStore.getState().selectResponders(ids, active.additive, false);
      return;
    }

    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hit = hooks.hitTest(world.x, world.y);
    const store = useGameStore.getState();
    if (store.commandMode === 'move' && !hit) {
      issueMove(screenToTile(world.x, world.y), shiftKey(pointer));
      store.setCommandMode(null);
      return;
    }
    if (hit?.kind === 'fire') store.selectFire(hit.id);
    else if (hit?.kind === 'hydrant') store.selectHydrant(hit.id);
    else if (hit?.kind === 'hose') store.selectHose(hit.id);
    else if (hit?.kind === 'object') store.selectObject(hit.id);
    else if (hit?.kind === 'vehicle') store.selectVehicle(hit.id);
    else if (hit?.kind === 'responder') store.selectResponders([hit.id], active.additive, active.additive);
    else store.clearSelection();
  });

  scene.input.on(
    'wheel',
    (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const camera = scene.cameras.main;
      hooks.onUserCamera();
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
    },
  );
}

function issueVehicle(vehicleId: string, queue: boolean): void {
  const { selection, snapshot } = useGameStore.getState();
  if (selection?.kind === 'team' && snapshot) {
    sendCommand({ type: 'board-team', teamId: selection.id, vehicleId });
    return;
  }
  const responderId = soleResponder(selection);
  if (responderId) {
    const aboard = snapshot?.entities.find((entity) => entity.id === responderId)?.aboardVehicleId;
    deliver(
      aboard === vehicleId
        ? { type: 'exit-vehicle', responderId, vehicleId }
        : { type: 'board-vehicle', responderId, vehicleId },
      queue,
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
  const responderId = soleResponder(selection);
  if (responderId) {
    const hose = snapshot?.hoses.find(
      (candidate) => candidate.kind === 'attack' && candidate.operatorId === responderId,
    );
    sendCommand(
      hose
        ? { type: 'operate-nozzle', responderId, hoseId: hose.id, fireId }
        : { type: 'suppress-fire', responderId, fireId },
    );
    return;
  }
  useGameStore.getState().selectFire(fireId);
}

function issueInteraction(objectId: string, queue: boolean): void {
  const { selection, snapshot } = useGameStore.getState();
  const object = snapshot?.objects.find((candidate) => candidate.id === objectId);
  if (!object) return;
  const command = commandFor(selection, object);
  if (command) deliver(command, queue);
  else useGameStore.getState().selectObject(objectId);
}

export function commandFor(selection: Selection, object: ObjectSnapshot): Command | null {
  if (selection?.kind === 'team' && object.objectType === 'locker') {
    return { type: 'retrieve-team', teamId: selection.id, lockerId: object.id };
  }
  const responderId = soleResponder(selection);
  if (!responderId) return null;
  if (object.objectType === 'door') {
    return { type: 'force-door', responderId, doorId: object.id };
  }
  if (object.objectType === 'panel') {
    return { type: 'operate-panel', responderId, panelId: object.id };
  }
  const item = object.contents.find((content) => !content.reserved) ?? object.contents[0];
  if (!item) return null;
  return {
    type: 'retrieve-equipment',
    responderId,
    lockerId: object.id,
    definitionId: item.definitionId,
  };
}

function issueHydrant(hydrantId: string): void {
  const { selection, snapshot } = useGameStore.getState();
  const vehicleId = snapshot?.team.apparatusId;
  const responderId = soleResponder(selection);
  if (responderId && vehicleId) {
    sendCommand({ type: 'connect-supply', responderId, hydrantId, vehicleId });
    return;
  }
  useGameStore.getState().selectHydrant(hydrantId);
}

function issueMove(destination: { x: number; y: number }, queue: boolean): void {
  const { selection, snapshot } = useGameStore.getState();
  if (selection?.kind === 'responders' && selection.ids.length > 1) {
    sendCommand({ type: 'move-group', responderIds: selection.ids, destination });
    return;
  }
  const responderId = soleResponder(selection);
  if (responderId) {
    const hose = snapshot?.hoses.find(
      (candidate) => candidate.kind === 'attack' && candidate.operatorId === responderId,
    );
    if (hose) {
      sendCommand({ type: 'reposition-nozzle', responderId, hoseId: hose.id, destination });
      return;
    }
    deliver({ type: 'move-responder', responderId, destination }, queue);
    return;
  }
  if (selection?.kind === 'team') {
    sendCommand({ type: 'move-team', teamId: selection.id, destination });
  }
}

function deliver(command: Command, queue: boolean): void {
  if (queue && isQueueable(command)) sendCommand({ type: 'enqueue', order: command });
  else sendCommand(command);
}

function isQueueable(command: Command): command is QueuedCommand {
  return (
    command.type === 'move-responder' ||
    command.type === 'retrieve-equipment' ||
    command.type === 'force-door' ||
    command.type === 'operate-panel' ||
    command.type === 'board-vehicle' ||
    command.type === 'exit-vehicle'
  );
}

function modifier(pointer: Phaser.Input.Pointer): boolean {
  const event = pointer.event;
  return event instanceof MouseEvent && (event.shiftKey || event.ctrlKey || event.metaKey);
}

function shiftKey(pointer: Phaser.Input.Pointer): boolean {
  return pointer.event instanceof MouseEvent && pointer.event.shiftKey;
}
