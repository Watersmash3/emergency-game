import type { Tile, Vec2 } from '@emergency/protocol';

export interface Movement {
  speed: number;
  path: Vec2[];
  destination: Tile | null;
}
