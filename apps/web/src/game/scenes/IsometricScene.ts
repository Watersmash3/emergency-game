import type { ObjectSnapshot, SimulationSnapshot } from '@emergency/protocol';
import { FIXED_DT_MS } from '@emergency/protocol';
import Phaser from 'phaser';

import { useGameStore } from '../../state/gameStore.ts';
import { bindSceneInput, type SceneHit } from '../input/sceneInput.ts';
import { worldToScreen } from '../rendering/iso.ts';
import { createPlaceholderTextures } from '../rendering/textures.ts';

interface SpriteView {
  token: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

export class IsometricScene extends Phaser.Scene {
  private unsubscribe?: () => void;
  private readonly sprites = new Map<string, SpriteView>();
  private readonly objectSprites = new Map<string, SpriteView>();
  private readonly tileImages = new Map<string, Phaser.GameObjects.Image>();
  private pathGraphics?: Phaser.GameObjects.Graphics;
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private mapReady = false;

  constructor() {
    super('incident');
  }

  create(): void {
    createPlaceholderTextures(this);
    this.pathGraphics = this.add.graphics().setDepth(10_000);
    this.selectionGraphics = this.add.graphics().setDepth(10_001);
    this.cameras.main.setRoundPixels(false);
    bindSceneInput(this, (worldX, worldY) => this.hitTest(worldX, worldY));
    this.unsubscribe = useGameStore.subscribe(() => {
      if (!this.isLive()) return;
      this.syncFromStore();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    });
    this.syncFromStore();
  }

  override update(): void {
    if (!this.isLive()) return;
    this.interpolate();
    this.drawPaths();
    this.drawSelection();
  }

  private isLive(): boolean {
    const status = this.sys?.settings.status;
    return status === Phaser.Scenes.CREATING || status === Phaser.Scenes.RUNNING;
  }

  private syncFromStore(): void {
    if (!this.isLive()) return;
    const snapshot = useGameStore.getState().snapshot;
    if (!snapshot) return;
    if (!this.mapReady) {
      this.buildMap(snapshot);
      this.mapReady = true;
      this.centerCamera(snapshot);
    }
    this.refreshBlocked(snapshot);
    this.ensureSprites(snapshot);
    this.ensureObjects(snapshot);
  }

  private buildMap(snapshot: SimulationSnapshot): void {
    const blocked = new Set(snapshot.blocked.map((tile) => `${tile.x},${tile.y}`));
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < snapshot.height; y += 1) {
      for (let x = 0; x < snapshot.width; x += 1) {
        const screen = worldToScreen(x + 0.5, y + 0.5);
        const key = `${x},${y}`;
        const image = this.add.image(
          screen.x,
          screen.y,
          blocked.has(key) ? 'tile-blocked' : 'tile-ground',
        );
        image.setOrigin(0.5, 0.5);
        image.setDepth(screen.y);
        this.tileImages.set(key, image);
        minX = Math.min(minX, screen.x);
        minY = Math.min(minY, screen.y);
        maxX = Math.max(maxX, screen.x);
        maxY = Math.max(maxY, screen.y);
      }
    }

    const pad = 160;
    this.cameras.main.setBounds(
      minX - pad,
      minY - pad,
      maxX - minX + pad * 2,
      maxY - minY + pad * 2,
    );
  }

  private centerCamera(snapshot: SimulationSnapshot): void {
    if (snapshot.entities.length === 0) return;
    const total = snapshot.entities.reduce(
      (sum, entity) => {
        const screen = worldToScreen(entity.position.x, entity.position.y);
        return { x: sum.x + screen.x, y: sum.y + screen.y };
      },
      { x: 0, y: 0 },
    );
    this.cameras.main.centerOn(
      total.x / snapshot.entities.length,
      total.y / snapshot.entities.length,
    );
  }

  private refreshBlocked(snapshot: SimulationSnapshot): void {
    const blocked = new Set(snapshot.blocked.map((tile) => `${tile.x},${tile.y}`));
    for (const [key, image] of this.tileImages) {
      image.setTexture(blocked.has(key) ? 'tile-blocked' : 'tile-ground');
    }
  }

  private ensureSprites(snapshot: SimulationSnapshot): void {
    snapshot.entities.forEach((entity, index) => {
      if (this.sprites.has(entity.id)) return;
      const token = this.add.image(0, 0, `responder-${index % 4}`).setOrigin(0.5, 0.5);
      const label = this.add
        .text(0, 0, entity.name, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '13px',
          color: '#f4f7f5',
          stroke: '#102018',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1);
      this.sprites.set(entity.id, { token, label });
    });
  }

  private ensureObjects(snapshot: SimulationSnapshot): void {
    for (const object of snapshot.objects) {
      const screen = worldToScreen(object.position.x + 0.5, object.position.y + 0.5);
      let view = this.objectSprites.get(object.id);
      if (!view) {
        const token = this.add.image(screen.x, screen.y, textureFor(object)).setOrigin(0.5, 0.5);
        const label = this.add
          .text(screen.x, screen.y - 22, object.name, {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '12px',
            color: '#f4f7f5',
            stroke: '#102018',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1);
        view = { token, label };
        this.objectSprites.set(object.id, view);
      }
      view.token.setTexture(textureFor(object));
      view.token.setPosition(screen.x, screen.y);
      view.label.setPosition(screen.x, screen.y - 22);
      view.token.setDepth(screen.y + 6);
      view.label.setDepth(screen.y + 7);
    }
  }

  private interpolate(): void {
    const { snapshot, previousSnapshot, snapshotAt } = useGameStore.getState();
    if (!snapshot) return;
    const alpha = Phaser.Math.Clamp((performance.now() - snapshotAt) / FIXED_DT_MS, 0, 1);

    for (const entity of snapshot.entities) {
      const view = this.sprites.get(entity.id);
      if (!view) continue;
      const previous =
        previousSnapshot?.entities.find((candidate) => candidate.id === entity.id)?.position ??
        entity.position;
      const x = previous.x + (entity.position.x - previous.x) * alpha;
      const y = previous.y + (entity.position.y - previous.y) * alpha;
      const screen = worldToScreen(x, y);
      view.token.setPosition(screen.x, screen.y);
      view.label.setPosition(screen.x, screen.y - 24);
      view.token.setDepth(screen.y + 8);
      view.label.setDepth(screen.y + 9);
    }
  }

  private drawPaths(): void {
    const snapshot = useGameStore.getState().snapshot;
    if (!snapshot || !this.pathGraphics) return;
    this.pathGraphics.clear();
    this.pathGraphics.lineStyle(2, 0xf2c14e, 0.8);
    for (const entity of snapshot.entities) {
      const view = this.sprites.get(entity.id);
      if (!view || entity.path.length === 0) continue;
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(view.token.x, view.token.y);
      for (const point of entity.path) {
        const screen = worldToScreen(point.x, point.y);
        this.pathGraphics.lineTo(screen.x, screen.y);
      }
      this.pathGraphics.strokePath();
    }
  }

  private drawSelection(): void {
    const snapshot = useGameStore.getState().snapshot;
    const selection = useGameStore.getState().selection;
    if (!this.selectionGraphics) return;
    this.selectionGraphics.clear();
    if (!snapshot || !selection) return;

    const ids =
      selection.kind === 'team'
        ? snapshot.team.memberIds
        : selection.kind === 'object'
          ? []
          : [selection.id];
    this.selectionGraphics.lineStyle(2, selection.kind === 'team' ? 0x8ee0b2 : 0x7ecbff, 1);
    for (const id of ids) {
      const view = this.sprites.get(id);
      if (!view) continue;
      this.selectionGraphics.strokeCircle(view.token.x, view.token.y, 18);
    }
    if (selection.kind === 'object') {
      const view = this.objectSprites.get(selection.id);
      if (!view) return;
      this.selectionGraphics.lineStyle(2, 0xe2b657, 1);
      this.selectionGraphics.strokeCircle(view.token.x, view.token.y, 16);
    }
  }

  private hitTest(worldX: number, worldY: number): SceneHit | null {
    let best: SceneHit | null = null;
    let bestDistance = 22;
    const consider = (kind: SceneHit['kind'], id: string, view: SpriteView) => {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, view.token.x, view.token.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { kind, id };
      }
    };
    for (const [id, view] of this.objectSprites) consider('object', id, view);
    for (const [id, view] of this.sprites) consider('responder', id, view);
    return best;
  }
}

function textureFor(object: ObjectSnapshot): string {
  if (object.objectType === 'locker') return 'object-locker';
  if (object.objectType === 'door')
    return object.state === 'open' ? 'object-door-open' : 'object-door';
  return object.state === 'operated' ? 'object-panel-on' : 'object-panel';
}
