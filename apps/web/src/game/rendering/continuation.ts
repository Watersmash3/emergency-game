interface ContinuityBody {
  id: string;
  position: { x: number; y: number };
}

export interface ContinuitySnapshot {
  scenarioId: string;
  tick: number;
  entities: ContinuityBody[];
  vehicles: ContinuityBody[];
}

/** Largest tick catch-up the simulation publishes in one step. */
const MAX_TICK_GAP = 8;
/** A responder can cross about 1.4 tiles in that catch-up. */
const RESPONDER_JUMP = 2;
/** A vehicle can cross about 3.2 tiles in that catch-up. */
const VEHICLE_JUMP = 4;

/** A normal step keeps the camera and the movement blend. A load does not. */
export function isTickContinuation(
  previous: ContinuitySnapshot | null,
  next: ContinuitySnapshot,
): boolean {
  if (!previous) return true;
  if (previous.scenarioId !== next.scenarioId) return false;
  const tickDelta = next.tick - previous.tick;
  if (tickDelta < 0 || tickDelta > MAX_TICK_GAP) return false;
  if (jumped(previous.entities, next.entities, RESPONDER_JUMP)) return false;
  if (jumped(previous.vehicles, next.vehicles, VEHICLE_JUMP)) return false;
  return true;
}

function jumped(previous: ContinuityBody[], next: ContinuityBody[], limit: number): boolean {
  for (const body of next) {
    const prior = previous.find((candidate) => candidate.id === body.id);
    if (!prior) return true;
    const distance = Math.hypot(
      body.position.x - prior.position.x,
      body.position.y - prior.position.y,
    );
    if (distance > limit) return true;
  }
  return false;
}
