/** Placeholder art keys. The scene asks for an asset instead of drawing a one-off shape. */
export interface SpriteAsset {
  key: string;
  originX: number;
  originY: number;
}

export const assets = {
  responder(index: number): SpriteAsset {
    return { key: `responder-${index % 4}`, originX: 0.5, originY: 0.9 };
  },
  engine: { key: 'vehicle-engine', originX: 0.5, originY: 0.72 } satisfies SpriteAsset,
  hydrant: { key: 'object-hydrant', originX: 0.5, originY: 0.82 } satisfies SpriteAsset,
  fire: { key: 'fire-live', originX: 0.5, originY: 0.86 } satisfies SpriteAsset,
  fireOut: { key: 'fire-out', originX: 0.5, originY: 0.86 } satisfies SpriteAsset,
  locker: { key: 'object-locker', originX: 0.5, originY: 0.78 } satisfies SpriteAsset,
  door: { key: 'object-door', originX: 0.5, originY: 0.78 } satisfies SpriteAsset,
  doorOpen: { key: 'object-door-open', originX: 0.5, originY: 0.78 } satisfies SpriteAsset,
  panel: { key: 'object-panel', originX: 0.5, originY: 0.78 } satisfies SpriteAsset,
  panelOn: { key: 'object-panel-on', originX: 0.5, originY: 0.78 } satisfies SpriteAsset,
  ground(variant: number): SpriteAsset {
    return { key: variant % 2 === 0 ? 'tile-ground' : 'tile-ground-alt', originX: 0.5, originY: 0.5 };
  },
  road: { key: 'tile-road', originX: 0.5, originY: 0.5 } satisfies SpriteAsset,
  structure: { key: 'tile-structure', originX: 0.5, originY: 0.72 } satisfies SpriteAsset,
  interior: { key: 'tile-interior', originX: 0.5, originY: 0.5 } satisfies SpriteAsset,
  interiorAlt: { key: 'tile-interior-alt', originX: 0.5, originY: 0.5 } satisfies SpriteAsset,
  foundation: { key: 'tile-foundation', originX: 0.5, originY: 0.5 } satisfies SpriteAsset,
  wallFull: { key: 'wall-full', originX: 0.5, originY: 0.7 } satisfies SpriteAsset,
  wallLow: { key: 'wall-low', originX: 0.5, originY: 0.7 } satisfies SpriteAsset,
  rubble: { key: 'prop-rubble', originX: 0.5, originY: 0.82 } satisfies SpriteAsset,
  shadow: { key: 'prop-shadow', originX: 0.5, originY: 0.5 } satisfies SpriteAsset,
};

export function doorAsset(state: string, axis: 'x' | 'y'): SpriteAsset {
  const leaf = state === 'open' ? 'open' : state === 'forced' ? 'forced' : state === 'locked' ? 'locked' : 'closed';
  return { key: `door-${axis}-${leaf}`, originX: 0.5, originY: 0.94 };
}

export function objectAsset(objectType: string, state: string, axis: 'x' | 'y' = 'x'): SpriteAsset {
  if (objectType === 'locker') return assets.locker;
  if (objectType === 'door') return doorAsset(state, axis);
  return state === 'operated' ? assets.panelOn : assets.panel;
}
