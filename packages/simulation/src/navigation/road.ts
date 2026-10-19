export interface RoadNode {
  id: string;
  x: number;
  y: number;
  kind: 'intersection' | 'staging' | 'spawn';
}

export function buildAdjacency(
  edges: readonly { from: string; to: string }[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adjacency.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    adjacency.set(from, list);
  };
  for (const edge of edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  for (const list of adjacency.values()) list.sort();
  return adjacency;
}

/** A* over road nodes. The path includes the start node, or null when no route exists. */
export function findRoadPath(
  nodes: ReadonlyMap<string, RoadNode>,
  adjacency: ReadonlyMap<string, readonly string[]>,
  startId: string,
  goalId: string,
): string[] | null {
  const start = nodes.get(startId);
  const goal = nodes.get(goalId);
  if (!start || !goal) return null;
  if (startId === goalId) return [startId];

  const open = [startId];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startId, 0]]);
  const fScore = new Map<string, number>([[startId, heuristic(start, goal)]]);

  while (open.length > 0) {
    open.sort((left, right) => (fScore.get(left) ?? Infinity) - (fScore.get(right) ?? Infinity));
    const currentId = open.shift();
    if (!currentId) break;
    if (currentId === goalId) return reconstruct(cameFrom, currentId);

    for (const neighborId of adjacency.get(currentId) ?? []) {
      const neighbor = nodes.get(neighborId);
      const current = nodes.get(currentId);
      if (!neighbor || !current) continue;
      const tentative = (gScore.get(currentId) ?? Infinity) + heuristic(current, neighbor);
      if (tentative >= (gScore.get(neighborId) ?? Infinity)) continue;
      cameFrom.set(neighborId, currentId);
      gScore.set(neighborId, tentative);
      fScore.set(neighborId, tentative + heuristic(neighbor, goal));
      if (!open.includes(neighborId)) open.push(neighborId);
    }
  }
  return null;
}

function heuristic(from: RoadNode, to: RoadNode): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

function reconstruct(cameFrom: Map<string, string>, currentId: string): string[] {
  const path = [currentId];
  let cursor = currentId;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor) ?? cursor;
    path.push(cursor);
  }
  path.reverse();
  return path;
}
