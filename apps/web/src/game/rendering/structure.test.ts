import { trainingYard } from '@emergency/content';
import { createSimulation } from '@emergency/simulation';
import { describe, expect, it } from 'vitest';

import { TILE_HEIGHT, worldToScreen } from './iso.ts';
import { assembleBuilding, roofCover, roofOutline, showWorldLabel, wallPresentation } from './structure.ts';

describe('building visual assembly', () => {
  const view = assembleBuilding(createSimulation(trainingYard).getSnapshot());

  it('builds a connected shell with doorway openings and room floors', () => {
    expect(view.walls.some((wall) => wall.x === 8 && wall.y === 10 && wall.role === 'far')).toBe(true);
    expect(view.walls.some((wall) => wall.x === 9 && wall.y === 12 && wall.role === 'near')).toBe(true);
    expect(view.walls.some((wall) => wall.x === 9 && wall.y === 10 && wall.role === 'partition')).toBe(true);
    expect(view.walls.some((wall) => wall.x === 10 && wall.y === 12)).toBe(false);
    expect(view.walls.length).toBeGreaterThan(12);
    expect(view.floors.filter((floor) => floor.roomId === 'room-south')).toHaveLength(3);
    expect(view.floors.find((floor) => floor.roomId === 'room-north')?.variant).not.toBe(
      view.floors.find((floor) => floor.roomId === 'room-south')?.variant,
    );
    expect(view.roofs).toContainEqual({ x: 10, y: 9 });
    expect(view.roofs).toContainEqual({ x: 8, y: 8 });
  });

  it('orients doors in their wall and leaves loose obstacles out of the shell', () => {
    expect(view.doors.find((door) => door.id === 'door-training')).toMatchObject({
      axis: 'x',
      interior: false,
    });
    expect(view.doors.find((door) => door.id === 'door-interior')).toMatchObject({
      axis: 'x',
      interior: true,
    });
    expect(view.obstacles).toContainEqual({ x: 6, y: 5 });
    expect(view.walls.some((wall) => wall.x === 6 && wall.y === 5)).toBe(false);
  });

  it('keeps far walls standing during a cutaway and drops the camera-facing ones', () => {
    expect(wallPresentation('far', true)).toBe('full');
    expect(wallPresentation('near', true)).toBe('curb');
    expect(wallPresentation('partition', true)).toBe('curb');
    expect(wallPresentation('near', false)).toBe('full');
  });

  it('seats the closed roof on the outer wall tops and leaves the entrance open', () => {
    const cover = roofCover(view);
    expect(cover).toContainEqual({ x: 8, y: 10 });
    expect(cover).toContainEqual({ x: 10, y: 11 });
    expect(cover).toContainEqual({ x: 10, y: 10 });
    expect(cover).not.toContainEqual({ x: 10, y: 12 });
    const cap = roofOutline(cover, 0).map((point) => ({ x: point.x, y: point.y - 28 }));
    const south = worldToScreen(12.5, 12.5);
    const north = worldToScreen(8.5, 8.5);
    expect(Math.max(...cap.map((point) => point.y))).toBeCloseTo(south.y + TILE_HEIGHT / 2 - 28, 0);
    expect(Math.min(...cap.map((point) => point.y))).toBeCloseTo(north.y - TILE_HEIGHT / 2 - 28, 0);
  });

  it('shows world labels for selection, hover, debug, or a close zoom', () => {
    expect(showWorldLabel({ debug: false, hovered: false, selected: false, zoom: 1 })).toBe(false);
    expect(showWorldLabel({ debug: false, hovered: true, selected: false, zoom: 1 })).toBe(true);
    expect(showWorldLabel({ debug: true, hovered: false, selected: false, zoom: 1 })).toBe(true);
    expect(showWorldLabel({ debug: false, hovered: false, selected: false, zoom: 1.7 })).toBe(true);
  });
});
