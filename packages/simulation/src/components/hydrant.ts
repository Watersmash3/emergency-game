import type { Tile } from '@emergency/protocol';

export interface Hydrant {
  name: string;
  available: boolean;
  flowCapacity: number;
  connectionId: string | null;
  interactionTiles: Tile[];
}
