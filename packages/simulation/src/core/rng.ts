export interface Rng {
  next(): number;
  getState(): number;
}

/** mulberry32. The same seed always produces the same sequence. */
export function createRng(seed: number, state = seed): Rng {
  let current = state >>> 0;

  return {
    next() {
      current = (current + 0x6d2b79f5) >>> 0;
      let t = current;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState() {
      return current;
    },
  };
}
