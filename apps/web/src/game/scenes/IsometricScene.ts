import type { SimulationSnapshot } from '@emergency/protocol';
import { FIXED_DT_MS } from '@emergency/protocol';
import Phaser from 'phaser';

import { useGameStore } from '../../state/gameStore.ts';
import { bindSceneInput, type SceneHit } from '../input/sceneInput.ts';
import { idsInside, type ScreenRect } from '../input/selection.ts';
import { assets, objectAsset } from '../rendering/assets.ts';
import { boundsCenter, fitZoom, mapScreenBounds, type Bounds } from '../rendering/camera.ts';
import { isTickContinuation } from '../rendering/continuation.ts';
import {
  buildingInteriorOpen,
  interiorRevealed,
  selectionInsideBuilding,
  tileInsideRoom,
} from '../rendering/interior.ts';
import { screenToTile, worldToScreen } from '../rendering/iso.ts';
import {
  assembleBuilding,
  roofCover,
  roofOutline,
  showWorldLabel,
  WALL_RISE,
  wallPresentation,
  type BuildingView,
} from '../rendering/structure.ts';
import { createPlaceholderTextures } from '../rendering/textures.ts';

interface SpriteView {
  token: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  shadow?: Phaser.GameObjects.Image;
}

export class IsometricScene extends Phaser.Scene {
  private unsubscribe?: () => void;
  private readonly sprites = new Map<string, SpriteView>();
  private readonly objectSprites = new Map<string, SpriteView>();
  private readonly vehicleSprites = new Map<string, SpriteView>();
  private readonly fireSprites = new Map<string, SpriteView>();
  private readonly hazardSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly hydrantSprites = new Map<string, SpriteView>();
  private readonly tileImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly wallSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly rubbleSprites = new Map<string, Phaser.GameObjects.Image>();
  private roofGraphics?: Phaser.GameObjects.Graphics;
  private readonly roadTiles = new Set<string>();
  private buildingView: BuildingView | null = null;
  private pathGraphics?: Phaser.GameObjects.Graphics;
  private hoseGraphics?: Phaser.GameObjects.Graphics;
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private marqueeGraphics?: Phaser.GameObjects.Graphics;
  private debugGraphics?: Phaser.GameObjects.Graphics;
  private readonly debugTexts: Phaser.GameObjects.Text[] = [];
  private mapReady = false;
  private snap = false;
  private autoFit = true;
  private mapBounds?: Bounds;
  private marquee: ScreenRect | null = null;
  private hover: SceneHit | null = null;
  private lastCamera = 0;
  private lastLayout = 0;
  private debugBuilt = false;

  constructor() {
    super('incident');
  }

  create(): void {
    createPlaceholderTextures(this);
    this.pathGraphics = this.add.graphics().setDepth(10_000);
    this.hoseGraphics = this.add.graphics().setDepth(9_000);
    this.selectionGraphics = this.add.graphics().setDepth(10_001);
    this.debugGraphics = this.add.graphics().setDepth(8_000);
    this.marqueeGraphics = this.add.graphics().setScrollFactor(0).setDepth(20_000);
    this.cameras.main.setRoundPixels(false);
    bindSceneInput(this, {
      hitTest: (worldX, worldY) => this.hitTest(worldX, worldY),
      respondersInRect: (rect) => this.respondersInRect(rect),
      setMarquee: (rect) => {
        this.marquee = rect;
      },
      onHover: (hit) => {
        this.hover = hit;
      },
      onUserCamera: () => {
        this.autoFit = false;
      },
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (this.autoFit) this.fitYard();
    });
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
    this.consumeCameraRequests();
    this.interpolate();
    this.applyLabels();
    this.drawHoses();
    this.drawPaths();
    this.drawSelection();
    this.drawMarquee();
    this.drawDebug();
    if (useGameStore.getState().follow) this.centerOnSelection(false);
    this.publishZoom();
  }

  private isLive(): boolean {
    const status = this.sys?.settings.status;
    return status === Phaser.Scenes.CREATING || status === Phaser.Scenes.RUNNING;
  }

  private syncFromStore(): void {
    if (!this.isLive()) return;
    const { snapshot, previousSnapshot } = useGameStore.getState();
    if (!snapshot) return;
    this.snap = !isTickContinuation(previousSnapshot, snapshot);
    if (!this.mapReady) {
      this.buildMap(snapshot);
      this.mapReady = true;
      this.autoFit = true;
      this.fitYard();
    } else if (this.snap) {
      this.autoFit = true;
      this.fitYard();
    }
    this.refreshSurfaces(snapshot);
    this.ensureSprites(snapshot);
    this.ensureObjects(snapshot);
    this.ensureVehicles(snapshot);
    this.ensureFires(snapshot);
    this.ensureHydrants(snapshot);
    this.syncHazards(snapshot);
  }

  private buildMap(snapshot: SimulationSnapshot): void {
    const blocked = new Set(snapshot.blocked.map((tile) => `${tile.x},${tile.y}`));
    this.roadTiles.clear();
    for (const key of roadTileKeys(snapshot)) {
      if (!blocked.has(key)) this.roadTiles.add(key);
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < snapshot.height; y += 1) {
      for (let x = 0; x < snapshot.width; x += 1) {
        const screen = worldToScreen(x + 0.5, y + 0.5);
        const key = `${x},${y}`;
        const asset = this.roadTiles.has(key) ? assets.road : assets.ground(x + y);
        const image = this.add.image(screen.x, screen.y, asset.key);
        if (snapshot.pathways.some((tile) => tile.x === x && tile.y === y) && !this.roadTiles.has(key)) {
          image.setTint(0xc9d7c2);
        }
        image.setOrigin(asset.originX, asset.originY);
        image.setDepth(screen.y);
        this.tileImages.set(key, image);
        minX = Math.min(minX, screen.x);
        minY = Math.min(minY, screen.y);
        maxX = Math.max(maxX, screen.x);
        maxY = Math.max(maxY, screen.y);
      }
    }

    this.mapBounds = mapScreenBounds(snapshot.width, snapshot.height);
    const pad = 180;
    this.cameras.main.setBounds(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  }

  private fitYard(): void {
    if (!this.mapBounds) return;
    const camera = this.cameras.main;
    const center = boundsCenter(this.mapBounds);
    camera.setZoom(fitZoom(camera.width, camera.height, this.mapBounds));
    camera.centerOn(center.x, center.y);
    this.publishZoom();
  }

  private consumeCameraRequests(): void {
    const state = useGameStore.getState();
    if (state.cameraToken !== this.lastCamera) {
      this.lastCamera = state.cameraToken;
      if (state.cameraMode === 'fit') {
        this.autoFit = true;
        this.fitYard();
      } else {
        this.autoFit = false;
        this.centerOnSelection(true);
      }
    }
    if (state.layoutToken !== this.lastLayout) {
      this.lastLayout = state.layoutToken;
      if (this.autoFit) this.fitYard();
    }
  }

  private centerOnSelection(zoomIn: boolean): void {
    const points = this.focusPoints();
    if (points.length === 0) {
      this.fitYard();
      return;
    }
    const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
      x: 0,
      y: 0,
    });
    const camera = this.cameras.main;
    if (zoomIn) {
      camera.setZoom(Phaser.Math.Clamp(Math.max(camera.zoom, 1.35), 0.4, 2.4));
    }
    camera.centerOn(total.x / points.length, total.y / points.length);
  }

  private focusPoints(): { x: number; y: number }[] {
    const { snapshot, selection, focusRoomId } = useGameStore.getState();
    const roomPoints = snapshot && focusRoomId
      ? (snapshot.rooms.find((room) => room.id === focusRoomId)?.tiles.map((tile) =>
          worldToScreen(tile.x + 0.5, tile.y + 0.5),
        ) ?? [])
      : [];
    if (!snapshot || !selection) return roomPoints;
    if (selection.kind === 'responders') {
      return [
        ...roomPoints,
        ...selection.ids.flatMap((id) => {
          const view = this.sprites.get(id);
          return view ? [{ x: view.token.x, y: view.token.y }] : [];
        }),
      ];
    }
    if (selection.kind === 'team') {
      return [
        ...roomPoints,
        ...snapshot.team.memberIds.flatMap((id) => {
          const view = this.sprites.get(id);
          return view ? [{ x: view.token.x, y: view.token.y }] : [];
        }),
      ];
    }
    const view =
      selection.kind === 'vehicle'
        ? this.vehicleSprites.get(selection.id)
        : selection.kind === 'fire'
          ? this.fireSprites.get(selection.id)
          : selection.kind === 'hydrant'
            ? this.hydrantSprites.get(selection.id)
            : selection.kind === 'object'
              ? this.objectSprites.get(selection.id)
              : undefined;
    return view ? [{ x: view.token.x, y: view.token.y }, ...roomPoints] : roomPoints;
  }

  private publishZoom(): void {
    const parent = this.game.canvas.parentElement;
    parent?.setAttribute('data-zoom', this.cameras.main.zoom.toFixed(2));
    parent?.setAttribute('data-camera', this.autoFit ? 'fit' : 'free');
  }

  private refreshSurfaces(snapshot: SimulationSnapshot): void {
    const view = assembleBuilding(snapshot);
    this.buildingView = view;
    const revealed = this.roofOpen(snapshot);
    const debug = useGameStore.getState().debug;
    const floors = new Map(view.floors.map((floor) => [`${floor.x},${floor.y}`, floor]));
    const walls = new Set(view.walls.map((wall) => `${wall.x},${wall.y}`));
    const doors = new Set(view.doors.map((door) => `${door.x},${door.y}`));
    const blocked = new Set(snapshot.blocked.map((tile) => `${tile.x},${tile.y}`));
    for (const [key, image] of this.tileImages) {
      const floor = floors.get(key);
      const [xText, yText] = key.split(',');
      const x = Number(xText);
      const y = Number(yText);
      const asset = floor
        ? floor.variant === 0
          ? assets.interior
          : assets.interiorAlt
        : walls.has(key) || doors.has(key)
          ? assets.foundation
          : this.roadTiles.has(key)
            ? assets.road
            : assets.ground(x + y);
      image.setTexture(asset.key);
      image.setOrigin(asset.originX, asset.originY);
      let tint = 0xffffff;
      if (debug && blocked.has(key) && !floor) tint = 0xffc1b0;
      else if (revealed && floor?.state === 'searched') tint = 0xd5ddd6;
      else if (revealed && floor?.state === 'searching') tint = 0xe7d7b0;
      else if (revealed && floor && !floor.discovered) tint = 0xb7aa9c;
      image.setTint(tint);
    }
    this.syncWalls(view, revealed);
    this.syncRoofs(view, revealed);
    this.syncRubble(view);
  }

  private syncWalls(view: BuildingView, revealed: boolean): void {
    const alive = new Set<string>();
    for (const wall of view.walls) {
      const key = `${wall.x},${wall.y}`;
      alive.add(key);
      const presentation = wallPresentation(wall.role, revealed);
      const asset = presentation === 'curb' ? assets.wallLow : assets.wallFull;
      let image = this.wallSprites.get(key);
      if (!image) {
        image = this.add.image(0, 0, asset.key).setOrigin(asset.originX, asset.originY);
        this.wallSprites.set(key, image);
      }
      const screen = worldToScreen(wall.x + 0.5, wall.y + 0.5);
      image.setTexture(asset.key);
      image.setOrigin(asset.originX, asset.originY);
      image.setPosition(screen.x, screen.y);
      image.setDepth(screen.y + 0.8);
      const damage = useGameStore.getState().snapshot?.damage.find((item) => item.x === wall.x && item.y === wall.y);
      image.setAlpha(damage?.failed ? 0 : revealed && wall.role === 'near' ? 0.55 : 1);
      image.setTint(damage && !damage.failed ? 0xc47a4a : 0xffffff);
      image.setVisible(!damage?.failed && (revealed || wall.role !== 'partition'));
    }
    for (const [key, image] of this.wallSprites) {
      if (!alive.has(key)) image.setVisible(false);
    }
  }

  private syncRoofs(view: BuildingView, revealed: boolean): void {
    const graphics = this.roofGraphics ?? this.add.graphics();
    this.roofGraphics = graphics;
    graphics.clear();
    const cover = roofCover(view);
    if (revealed || cover.length === 0) {
      graphics.setVisible(false);
      return;
    }
    const cap = roofOutline(cover, 0).map((point) => ({ x: point.x, y: point.y - WALL_RISE }));
    const fascia = cap.map((point) => ({ x: point.x, y: point.y + 6 }));
    const depth = Math.max(...cover.map((tile) => worldToScreen(tile.x + 0.5, tile.y + 0.5).y)) + 36;
    fillPolygon(graphics, fascia, 0x6a574c);
    fillPolygon(graphics, cap, 0x9a8070);
    graphics.setDepth(depth);
    graphics.setVisible(true);
  }

  private syncRubble(view: BuildingView): void {
    const alive = new Set<string>();
    for (const tile of view.obstacles) {
      const key = `${tile.x},${tile.y}`;
      alive.add(key);
      let image = this.rubbleSprites.get(key);
      if (!image) {
        image = this.add.image(0, 0, assets.rubble.key).setOrigin(assets.rubble.originX, assets.rubble.originY);
        this.rubbleSprites.set(key, image);
      }
      const screen = worldToScreen(tile.x + 0.5, tile.y + 0.5);
      image.setPosition(screen.x, screen.y);
      image.setDepth(screen.y + 1);
      image.setVisible(true);
    }
    for (const [key, image] of this.rubbleSprites) {
      if (!alive.has(key)) image.setVisible(false);
    }
  }

  private ensureSprites(snapshot: SimulationSnapshot): void {
    snapshot.entities.forEach((entity, index) => {
      if (this.sprites.has(entity.id)) return;
      const asset = assets.responder(index);
      const token = this.add.image(0, 0, asset.key).setOrigin(asset.originX, asset.originY);
      const label = this.label(entity.name);
      const shadow = this.shadow();
      this.sprites.set(entity.id, { token, label, shadow });
    });
  }

  private ensureObjects(snapshot: SimulationSnapshot): void {
    for (const object of snapshot.objects) {
      const screen = worldToScreen(object.position.x + 0.5, object.position.y + 0.5);
      const piece = this.buildingView?.doors.find((door) => door.id === object.id);
      const asset = objectAsset(object.objectType, object.state, piece?.axis ?? 'x');
      let view = this.objectSprites.get(object.id);
      if (!view) {
        const token = this.add.image(screen.x, screen.y, asset.key).setOrigin(asset.originX, asset.originY);
        view = { token, label: this.label(object.name), shadow: this.shadow() };
        this.objectSprites.set(object.id, view);
      }
      view.token.setTexture(asset.key);
      view.token.setTint(object.objectType === 'window' ? (object.state === 'open' ? 0xd7f3ff : 0x6aa4c8) : 0xffffff);
      view.token.setOrigin(asset.originX, asset.originY);
      view.token.setPosition(screen.x, screen.y);
      view.label.setPosition(screen.x, screen.y - 36);
      view.token.setDepth(screen.y + (piece ? 22 : 14));
      view.label.setDepth(screen.y + 7);
      view.shadow?.setPosition(screen.x, screen.y + 4);
      view.shadow?.setDepth(screen.y + 0.3);
      const revealed = this.roofOpen(snapshot);
      const exterior = snapshot.buildings.some((building) => building.entranceDoorId === object.id);
      const inside = tileInsideRoom(snapshot, object.position.x, object.position.y);
      const visible = revealed || exterior || (!inside && !piece?.interior);
      view.token.setVisible(visible);
      view.shadow?.setVisible(visible);
      view.label.setVisible(false);
      view.token.setTint(0xffffff);
    }
  }

  private ensureVehicles(snapshot: SimulationSnapshot): void {
    for (const vehicle of snapshot.vehicles) {
      if (this.vehicleSprites.has(vehicle.id)) continue;
      const token = this.add
        .image(0, 0, assets.engine.key)
        .setOrigin(assets.engine.originX, assets.engine.originY);
      this.vehicleSprites.set(vehicle.id, { token, label: this.label(vehicle.name), shadow: this.shadow() });
    }
  }

  private ensureHydrants(snapshot: SimulationSnapshot): void {
    for (const hydrant of snapshot.hydrants) {
      if (this.hydrantSprites.has(hydrant.id)) continue;
      const token = this.add
        .image(0, 0, assets.hydrant.key)
        .setOrigin(assets.hydrant.originX, assets.hydrant.originY);
      this.hydrantSprites.set(hydrant.id, { token, label: this.label(hydrant.name), shadow: this.shadow() });
    }
  }

  private ensureFires(snapshot: SimulationSnapshot): void {
    for (const fire of snapshot.fires) {
      if (this.fireSprites.has(fire.id)) continue;
      const token = this.add.image(0, 0, assets.fire.key).setOrigin(assets.fire.originX, assets.fire.originY);
      this.fireSprites.set(fire.id, { token, label: this.label(fire.name), shadow: this.shadow() });
    }
  }

  private syncHazards(snapshot: SimulationSnapshot): void {
    const open = this.roofOpen(snapshot);
    const wanted = new Set<string>();
    for (const cell of snapshot.hazards) {
      const inside = tileInsideRoom(snapshot, cell.x, cell.y);
      if (inside && !open) continue;
      const screen = worldToScreen(cell.x + 0.5, cell.y + 0.5);
      const debug = useGameStore.getState().debug;
      const thermal = useGameStore.getState().thermalView || debug;
      const hiddenHotspot = cell.hotspot && !cell.revealed && !debug;
      const showHotspot = cell.hotspot && (cell.revealed || debug);
      if (!hiddenHotspot && (cell.smoke > 0.08 || cell.temperature > 90 || thermal)) {
        const key = `smoke:${cell.x},${cell.y}`;
        wanted.add(key);
        const image = this.hazardSprites.get(key) ?? this.add.image(screen.x, screen.y, 'hazard-smoke');
        const heat = cell.temperature > 110;
        image.setPosition(screen.x, screen.y - (cell.smoke > 0.2 ? 10 : 0));
        image.setDepth(screen.y + 1.2);
        image.setAlpha(thermal ? 0.45 : Math.min(0.7, cell.smoke * 0.75 + (heat ? 0.14 : 0)));
        image.setTint(thermal ? thermalTint(cell.temperature) : heat ? 0xffb060 : 0xc5ced6);
        this.hazardSprites.set(key, image);
      }
      if (cell.steam > 0.15) {
        const key = `steam:${cell.x},${cell.y}`;
        wanted.add(key);
        const image = this.hazardSprites.get(key) ?? this.add.image(screen.x, screen.y, 'hazard-smoke');
        image.setPosition(screen.x, screen.y - 18);
        image.setDepth(screen.y + 4);
        image.setAlpha(Math.min(0.55, cell.steam));
        image.setTint(0xf4f7fb);
        image.setScale(0.7);
        this.hazardSprites.set(key, image);
      }
      if (showHotspot) {
        const key = `hot:${cell.x},${cell.y}`;
        wanted.add(key);
        const image = this.hazardSprites.get(key) ?? this.add.image(screen.x, screen.y, assets.fireOut.key);
        image.setPosition(screen.x, screen.y - 4);
        image.setDepth(screen.y + 3.2);
        image.setScale(0.45);
        image.setTint(0xffc14a);
        this.hazardSprites.set(key, image);
      }
      const floor = this.tileImages.get(`${cell.x},${cell.y}`);
      if (floor && !thermal) {
        if (cell.water > 0.3) floor.setTint(0x8aa4b5);
        else if (cell.char > 0.25) floor.setTint(0x6a5648);
      }
      const occupied = snapshot.fires.some(
        (fire) => !fire.out && fire.position.x === cell.x && fire.position.y === cell.y,
      );
      if (cell.combustion > 0.18 && !occupied) {
        const key = `flame:${cell.x},${cell.y}`;
        wanted.add(key);
        const image = this.hazardSprites.get(key) ?? this.add.image(screen.x, screen.y, assets.fire.key);
        image.setOrigin(assets.fire.originX, assets.fire.originY);
        image.setPosition(screen.x, screen.y - 6);
        image.setDepth(screen.y + 3);
        image.setScale(0.5 + cell.combustion * 0.35);
        image.setAlpha(0.92);
        this.hazardSprites.set(key, image);
      }
    }
    for (const [key, image] of this.hazardSprites) {
      if (wanted.has(key)) continue;
      image.destroy();
      this.hazardSprites.delete(key);
    }
  }

  private label(name: string): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, name, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: '#f4f7f5',
        stroke: '#101418',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
  }

  private shadow(): Phaser.GameObjects.Image {
    return this.add.image(0, 0, assets.shadow.key).setOrigin(assets.shadow.originX, assets.shadow.originY);
  }

  private applyLabels(): void {
    const state = useGameStore.getState();
    const zoom = this.cameras.main.zoom;
    const hover = this.hover?.id ?? null;
    const selected = new Set<string>();
    if (state.selection?.kind === 'responders') {
      for (const id of state.selection.ids) selected.add(id);
    } else if (state.selection?.kind === 'team') {
      for (const id of state.snapshot?.team.memberIds ?? []) selected.add(id);
    } else if (state.selection) {
      selected.add(state.selection.id);
    }
    const paint = (id: string, view: SpriteView) => {
      view.label.setVisible(
        view.token.visible &&
          showWorldLabel({
            debug: state.debug,
            hovered: hover === id,
            selected: selected.has(id),
            zoom,
          }),
      );
    };
    for (const [id, view] of this.sprites) paint(id, view);
    for (const [id, view] of this.objectSprites) paint(id, view);
    for (const [id, view] of this.vehicleSprites) paint(id, view);
    for (const [id, view] of this.fireSprites) paint(id, view);
    for (const [id, view] of this.hydrantSprites) paint(id, view);
  }

  private interpolate(): void {
    const { snapshot, previousSnapshot, snapshotAt, debug } = useGameStore.getState();
    if (!snapshot) return;
    const alpha = this.snap
      ? 1
      : Phaser.Math.Clamp((performance.now() - snapshotAt) / FIXED_DT_MS, 0, 1);

    for (const entity of snapshot.entities) {
      const view = this.sprites.get(entity.id);
      if (!view) continue;
      const previous =
        previousSnapshot?.entities.find((candidate) => candidate.id === entity.id)?.position ??
        entity.position;
      const x = previous.x + (entity.position.x - previous.x) * alpha;
      const y = previous.y + (entity.position.y - previous.y) * alpha;
      const screen = worldToScreen(x, y);
      const next = entity.path[0];
      if (next) {
        const ahead = worldToScreen(next.x, next.y);
        view.token.setFlipX(ahead.x < screen.x);
      }
      view.token.setPosition(screen.x, screen.y);
      view.label.setText(debug ? `${entity.name}  ${entity.id}` : entity.name);
      view.label.setPosition(screen.x, screen.y - 30);
      view.token.setDepth(screen.y + 6);
      view.label.setDepth(screen.y + 9);
      const revealed = this.roofOpen(snapshot);
      const inside = tileInsideRoom(snapshot, Math.floor(x), Math.floor(y));
      const visible = revealed || !inside;
      view.token.setVisible(visible);
      const standing = snapshot.hazards.find(
        (cell) => cell.x === Math.floor(x) && cell.y === Math.floor(y),
      );
      const condition = snapshot.exposure.find((entry) => entry.responderId === entity.id);
      const obscured = (standing?.smoke ?? 0) > 0.45;
      view.token.setAlpha(obscured ? 0.4 : 1);
      view.token.setTint((condition?.exposure ?? 0) >= 0.35 || obscured ? 0xffb089 : 0xffffff);
      view.shadow?.setPosition(screen.x, screen.y + 2);
      view.shadow?.setDepth(screen.y + 0.2);
      view.shadow?.setVisible(visible);
    }

    this.syncHazards(snapshot);

    for (const vehicle of snapshot.vehicles) {
      const view = this.vehicleSprites.get(vehicle.id);
      if (!view) continue;
      const previous = previousSnapshot?.vehicles.find((candidate) => candidate.id === vehicle.id);
      const from = previous?.position ?? vehicle.position;
      const x = from.x + (vehicle.position.x - from.x) * alpha;
      const y = from.y + (vehicle.position.y - from.y) * alpha;
      const heading = lerpAngle(previous?.heading ?? vehicle.heading, vehicle.heading, alpha);
      const screen = worldToScreen(x, y);
      view.token.setPosition(screen.x, screen.y);
      view.token.setRotation(headingToScreen(heading));
      view.label.setText(debug ? `${vehicle.name}  ${vehicle.id}` : vehicle.name);
      view.label.setPosition(screen.x, screen.y - 36);
      view.token.setDepth(screen.y + 4);
      view.label.setDepth(screen.y + 5);
      view.shadow?.setPosition(screen.x, screen.y + 6);
      view.shadow?.setDepth(screen.y + 0.2);
      view.shadow?.setVisible(true);
    }

    for (const fire of snapshot.fires) {
      const view = this.fireSprites.get(fire.id);
      if (!view) continue;
      const asset = fire.out ? assets.fireOut : assets.fire;
      const screen = worldToScreen(fire.position.x + 0.5, fire.position.y + 0.5);
      const ratio = fire.maxIntensity > 0 ? fire.intensity / fire.maxIntensity : 0;
      view.token.setTexture(asset.key);
      view.token.setOrigin(asset.originX, asset.originY);
      view.token.setScale(fire.out ? 0.7 : 0.85 + ratio * 0.45);
      view.token.setPosition(screen.x, screen.y);
      view.label.setText(fire.out ? `${fire.name} out` : fire.name);
      view.label.setPosition(screen.x, screen.y - 34);
      view.token.setDepth(screen.y + 3);
      view.label.setDepth(screen.y + 3.5);
      view.shadow?.setPosition(screen.x, screen.y + 2);
      view.shadow?.setDepth(screen.y + 0.2);
    }

    for (const hydrant of snapshot.hydrants) {
      const view = this.hydrantSprites.get(hydrant.id);
      if (!view) continue;
      const screen = worldToScreen(hydrant.position.x + 0.5, hydrant.position.y + 0.5);
      view.token.setPosition(screen.x, screen.y);
      view.label.setText(hydrant.connectionId ? `${hydrant.name} connected` : hydrant.name);
      view.label.setPosition(screen.x, screen.y - 28);
      view.token.setDepth(screen.y + 2);
      view.label.setDepth(screen.y + 2.5);
      view.shadow?.setPosition(screen.x, screen.y + 2);
      view.shadow?.setDepth(screen.y + 0.2);
    }
  }

  private drawHoses(): void {
    const snapshot = useGameStore.getState().snapshot;
    const selection = useGameStore.getState().selection;
    if (!snapshot || !this.hoseGraphics) return;
    this.hoseGraphics.clear();
    const selected = new Set(selection?.kind === 'responders' ? selection.ids : []);
    for (const hose of snapshot.hoses) {
      if (hose.route.length === 0) continue;
      const color = hose.kind === 'supply' ? 0x3d7ec9 : 0xe04b3a;
      this.hoseGraphics.lineStyle(hose.flow > 0 ? 5 : 3, color, hose.state === 'open' ? 1 : 0.75);
      const first = hose.route[0];
      if (!first) continue;
      const start = worldToScreen(first.x, first.y);
      this.hoseGraphics.beginPath();
      this.hoseGraphics.moveTo(start.x, start.y);
      for (const point of hose.route.slice(1)) {
        const screen = worldToScreen(point.x, point.y);
        this.hoseGraphics.lineTo(screen.x, screen.y);
      }
      this.hoseGraphics.strokePath();
      const last = hose.route[hose.route.length - 1];
      const previous = hose.route[hose.route.length - 2] ?? first;
      if (last && hose.flow > 0) {
        const end = worldToScreen(last.x, last.y);
        const before = worldToScreen(previous.x, previous.y);
        const angle = Math.atan2(end.y - before.y, end.x - before.x);
        this.hoseGraphics.lineStyle(2, 0xb9dcff, 0.9);
        for (const spread of [-0.5, -0.2, 0.2, 0.5]) {
          this.hoseGraphics.lineBetween(
            end.x,
            end.y,
            end.x + Math.cos(angle + spread) * 22,
            end.y + Math.sin(angle + spread) * 22,
          );
        }
      }
      if (last && hose.operatorId && selected.has(hose.operatorId)) {
        const end = worldToScreen(last.x, last.y);
        const remaining = Math.max(0, hose.maxLength - hose.length);
        this.hoseGraphics.lineStyle(1, color, 0.55);
        this.hoseGraphics.strokeCircle(end.x, end.y, 14 + remaining * 8);
      }
    }
  }

  private drawPaths(): void {
    const snapshot = useGameStore.getState().snapshot;
    if (!snapshot || !this.pathGraphics) return;
    this.pathGraphics.clear();
    const selection = useGameStore.getState().selection;
    const debug = useGameStore.getState().debug;
    const selected = new Set<string>();
    if (selection?.kind === 'responders') for (const id of selection.ids) selected.add(id);
    if (selection?.kind === 'team') {
      for (const id of snapshot.team.memberIds) selected.add(id);
    }
    this.pathGraphics.lineStyle(2, 0xf2c14e, 0.9);
    for (const entity of snapshot.entities) {
      if (!debug && !selected.has(entity.id)) continue;
      const view = this.sprites.get(entity.id);
      if (!view || entity.path.length === 0) continue;
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(view.token.x, view.token.y);
      let end = { x: view.token.x, y: view.token.y };
      for (const point of entity.path) {
        end = worldToScreen(point.x, point.y);
        this.pathGraphics.lineTo(end.x, end.y);
      }
      this.pathGraphics.strokePath();
      marker(this.pathGraphics, end.x, end.y, 0xf2c14e);
    }
    this.pathGraphics.lineStyle(1, 0x7ecbff, 0.45);
    for (const zone of snapshot.command.zones) {
      const screen = worldToScreen(zone.x + 0.5, zone.y + 0.5);
      this.pathGraphics.strokeCircle(screen.x, screen.y, 18);
    }
    snapshot.orders.forEach((order, index) => {
      if (!order.destination) return;
      const screen = worldToScreen(order.destination.x + 0.5, order.destination.y + 0.5);
      marker(this.pathGraphics, screen.x, screen.y, index === 0 ? 0x7ecbff : 0x9aa8b5);
    });
  }

  private drawSelection(): void {
    const snapshot = useGameStore.getState().snapshot;
    const selection = useGameStore.getState().selection;
    if (!this.selectionGraphics) return;
    this.selectionGraphics.clear();
    if (snapshot && this.hover?.kind === 'room') this.paintRoom(snapshot, this.hover.id, 0xf4f7f5, 0.35);
    const focus = useGameStore.getState().focusRoomId;
    if (snapshot && focus) this.paintRoom(snapshot, focus, 0x7ecbff, 0.55);
    if (this.hover?.kind === 'responder') {
      const view = this.sprites.get(this.hover.id);
      if (view) {
        this.selectionGraphics.lineStyle(2, 0xf4f7f5, 0.7);
        this.selectionGraphics.strokeCircle(view.token.x, view.token.y - 22, 16);
      }
    }
    if (!snapshot || !selection) return;

    if (selection.kind === 'team' || selection.kind === 'responders') {
      const ids = selection.kind === 'team' ? snapshot.team.memberIds : selection.ids;
      const color = selection.kind === 'team' ? 0x8ee0b2 : 0x7ecbff;
      this.selectionGraphics.lineStyle(selection.kind === 'team' ? 2 : 3, color, 1);
      for (const id of ids) {
        const view = this.sprites.get(id);
        if (!view) continue;
        this.selectionGraphics.strokeCircle(view.token.x, view.token.y - 22, 18);
        if (selection.kind === 'team') {
          this.selectionGraphics.strokeCircle(view.token.x, view.token.y - 22, 24);
        }
      }
    }
    const single =
      selection.kind === 'object'
        ? this.objectSprites.get(selection.id)
        : selection.kind === 'vehicle'
          ? this.vehicleSprites.get(selection.id)
          : selection.kind === 'fire'
            ? this.fireSprites.get(selection.id)
            : selection.kind === 'hydrant'
              ? this.hydrantSprites.get(selection.id)
              : undefined;
    if (single) {
      this.selectionGraphics.lineStyle(2, 0xe2b657, 1);
      this.selectionGraphics.strokeCircle(single.token.x, single.token.y - 6, selection.kind === 'vehicle' ? 30 : 16);
    }
  }

  private drawMarquee(): void {
    if (!this.marqueeGraphics) return;
    this.marqueeGraphics.clear();
    if (!this.marquee) return;
    const left = Math.min(this.marquee.left, this.marquee.right);
    const top = Math.min(this.marquee.top, this.marquee.bottom);
    const width = Math.abs(this.marquee.right - this.marquee.left);
    const height = Math.abs(this.marquee.bottom - this.marquee.top);
    this.marqueeGraphics.fillStyle(0x7ecbff, 0.15);
    this.marqueeGraphics.lineStyle(1, 0x7ecbff, 0.9);
    this.marqueeGraphics.fillRect(left, top, width, height);
    this.marqueeGraphics.strokeRect(left, top, width, height);
  }

  private drawDebug(): void {
    const snapshot = useGameStore.getState().snapshot;
    const debug = useGameStore.getState().debug;
    if (!snapshot || !this.debugGraphics) return;
    this.debugGraphics.clear();
    if (!debug) {
      if (this.debugBuilt) {
        for (const text of this.debugTexts) text.destroy();
        this.debugTexts.length = 0;
        this.debugBuilt = false;
      }
      return;
    }
    if (!this.debugBuilt) {
      for (let y = 0; y < snapshot.height; y += 1) {
        for (let x = 0; x < snapshot.width; x += 1) {
          const screen = worldToScreen(x + 0.5, y + 0.5);
          const text = this.add
            .text(screen.x, screen.y, `${x},${y}`, {
              fontFamily: 'Segoe UI, sans-serif',
              fontSize: '10px',
              color: '#d5e0d8',
            })
            .setOrigin(0.5)
            .setDepth(screen.y + 0.5);
          this.debugTexts.push(text);
        }
      }
      this.debugBuilt = true;
    }
    this.debugGraphics.lineStyle(1, 0xf2c14e, 0.9);
    for (const road of snapshot.roads) {
      const screen = worldToScreen(road.position.x + 0.5, road.position.y + 0.5);
      this.debugGraphics.strokeCircle(screen.x, screen.y, 8);
    }
  }

  private respondersInRect(rect: ScreenRect): string[] {
    const camera = this.cameras.main;
    return idsInside(
      [...this.sprites.entries()].map(([id, view]) => ({
        id,
        x: (view.token.x - camera.scrollX) * camera.zoom,
        y: (view.token.y - camera.scrollY) * camera.zoom,
      })),
      rect,
    );
  }

  private hitTest(worldX: number, worldY: number): SceneHit | null {
    let best: SceneHit | null = null;
    let bestDistance = 36;
    const consider = (kind: SceneHit['kind'], id: string, view: SpriteView, radius: number) => {
      const distance = Phaser.Math.Distance.Between(worldX, worldY, view.token.x, view.token.y);
      if (distance < radius && distance < bestDistance) {
        bestDistance = distance;
        best = { kind, id };
      }
    };
    for (const [id, view] of this.fireSprites) consider('fire', id, view, 24);
    for (const [id, view] of this.hydrantSprites) consider('hydrant', id, view, 22);
    for (const [id, view] of this.objectSprites) consider('object', id, view, 22);
    for (const [id, view] of this.vehicleSprites) consider('vehicle', id, view, 36);
    for (const [id, view] of this.sprites) consider('responder', id, view, 22);
    if (!best && this.roofOpen(useGameStore.getState().snapshot)) {
      const tile = screenToTile(worldX, worldY);
      const room = useGameStore
        .getState()
        .snapshot?.rooms.find((candidate) =>
          candidate.tiles.some((entry) => entry.x === tile.x && entry.y === tile.y),
        );
      if (room) return { kind: 'room', id: room.id };
    }
    return best;
  }

  private roofOpen(snapshot: SimulationSnapshot | null): boolean {
    if (!snapshot) return false;
    const state = useGameStore.getState();
    const ids =
      state.selection?.kind === 'responders'
        ? state.selection.ids
        : state.selection?.kind === 'team'
          ? snapshot.team.memberIds
          : [];
    return interiorRevealed(
      state.roofMode,
      selectionInsideBuilding(snapshot, ids),
      state.focusRoomId !== null,
      buildingInteriorOpen(snapshot),
    );
  }

  private paintRoom(
    snapshot: SimulationSnapshot | null,
    roomId: string,
    color: number,
    alpha: number,
  ): void {
    const room = snapshot?.rooms.find((candidate) => candidate.id === roomId);
    if (!room || !this.selectionGraphics) return;
    this.selectionGraphics.fillStyle(color, alpha);
    for (const tile of room.tiles) {
      const screen = worldToScreen(tile.x + 0.5, tile.y + 0.5);
      this.selectionGraphics.fillTriangle(
        screen.x,
        screen.y - 16,
        screen.x + 32,
        screen.y,
        screen.x,
        screen.y + 16,
      );
      this.selectionGraphics.fillTriangle(
        screen.x,
        screen.y - 16,
        screen.x - 32,
        screen.y,
        screen.x,
        screen.y + 16,
      );
    }
  }
}

function thermalTint(temperature: number): number {
  if (temperature < 40) return 0x3d6ea8;
  if (temperature < 80) return 0x2f9e44;
  if (temperature < 140) return 0xf0b429;
  return 0xe03131;
}

function marker(graphics: Phaser.GameObjects.Graphics | undefined, x: number, y: number, color: number): void {
  if (!graphics) return;
  graphics.fillStyle(color, 0.9);
  graphics.fillTriangle(x, y - 10, x + 8, y, x, y + 6);
  graphics.fillTriangle(x, y - 10, x - 8, y, x, y + 6);
}

function fillPolygon(
  graphics: Phaser.GameObjects.Graphics,
  points: { x: number; y: number }[],
  color: number,
): void {
  const first = points[0];
  if (!first || points.length < 3) return;
  graphics.fillStyle(color, 1);
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
  graphics.closePath();
  graphics.fillPath();
}

function roadTileKeys(snapshot: SimulationSnapshot): string[] {
  const nodes = new Map(snapshot.roads.map((node) => [node.id, node.position]));
  const keys: string[] = [];
  const paint = (x: number, y: number) => keys.push(`${x},${y}`);
  for (const node of snapshot.roads) paint(node.position.x, node.position.y);
  for (const edge of snapshot.roadEdges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(from.x + ((to.x - from.x) * step) / Math.max(steps, 1));
      const y = Math.round(from.y + ((to.y - from.y) * step) / Math.max(steps, 1));
      paint(x, y);
    }
  }
  return keys;
}

function headingToScreen(heading: number): number {
  const ahead = worldToScreen(0.5 + Math.cos(heading), 0.5 + Math.sin(heading));
  const origin = worldToScreen(0.5, 0.5);
  return Math.atan2(ahead.y - origin.y, ahead.x - origin.x);
}

function lerpAngle(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}
