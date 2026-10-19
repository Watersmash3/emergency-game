import type { ObjectType, Tile } from '@emergency/protocol';

export interface Interactable {
  name: string;
  objectType: ObjectType;
  state: string;
  requiredCapability?: string;
  interactionTiles: Tile[];
}
