/**
 * Seeded PRNG (mulberry32) whose entire state is a single uint32, so it can be
 * stored inside the serialized game state. Every random outcome (dice, deck
 * shuffles) must go through here so a game can be replayed from its action log.
 */
export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the advanced state. */
export function nextFloat(state: RngState): [value: number, next: RngState] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Returns an integer in [min, max] inclusive and the advanced state. */
export function nextInt(
  state: RngState,
  min: number,
  max: number,
): [value: number, next: RngState] {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`invalid range [${min}, ${max}]`);
  }
  const [f, next] = nextFloat(state);
  return [min + Math.floor(f * (max - min + 1)), next];
}

/** Fisher–Yates shuffle returning a new array and the advanced state. */
export function shuffle<T>(state: RngState, items: readonly T[]): [result: T[], next: RngState] {
  const result = [...items];
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    let j: number;
    [j, s] = nextInt(s, 0, i);
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return [result, s];
}
