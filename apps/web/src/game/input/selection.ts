export type Selection =
  | { kind: 'responders'; ids: string[] }
  | { kind: 'team'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'fire'; id: string }
  | { kind: 'hydrant'; id: string }
  | { kind: 'hose'; id: string }
  | null;

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function soleResponder(selection: Selection): string | null {
  if (selection?.kind !== 'responders' || selection.ids.length !== 1) return null;
  return selection.ids[0] ?? null;
}

/** Replace, add, or toggle responder ids. Drag-add does not toggle; shift-click does. */
export function mergeIds(
  current: readonly string[],
  incoming: readonly string[],
  additive: boolean,
  toggle: boolean,
): string[] {
  if (!additive) return [...new Set(incoming)];
  const next = new Set(current);
  for (const id of incoming) {
    if (toggle && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}

export function idsInside(
  points: readonly { id: string; x: number; y: number }[],
  rect: ScreenRect,
): string[] {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  return points
    .filter((point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom)
    .map((point) => point.id);
}
