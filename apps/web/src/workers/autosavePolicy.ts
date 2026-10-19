/** Autosave only after the player has changed the session, so a reload cannot replace a recovery snapshot with the opening layout. */
export function shouldAutosave(
  sessionStarted: boolean,
  beforeTick: number,
  afterTick: number,
  interval = 100,
): boolean {
  if (!sessionStarted || afterTick <= beforeTick) return false;
  return Math.floor(afterTick / interval) > Math.floor(beforeTick / interval);
}
