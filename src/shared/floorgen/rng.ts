/**
 * Seeded PRNG for floor generation.
 *
 * Owner: Agent F1a (floors). Pure: no Math.random, no Date, no I/O — the same seed
 * string yields the same stream on server and client, which is what makes lazy
 * per-room compilation safe in co-op.
 *
 * Hash: FNV-1a (32 bit) finished with a murmur3 avalanche so near-identical seed
 * strings ("w:1", "w:2") do not give correlated streams. Generator: mulberry32.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Integer in [min, max], both inclusive. */
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; weights must be >= 0 with a positive sum. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Returns a new shuffled array (Fisher-Yates); the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
}

export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Joins seed parts unambiguously: seedKey('a', 'b:c') !== seedKey('a:b', 'c'). */
export function seedKey(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).replace(/[\\|]/g, (ch) => `\\${ch}`)).join('|');
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    range: (min, max) => min + int(max - min + 1),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[int(items.length)]!;
    },
    weighted: (items, weight) => {
      if (items.length === 0) throw new Error('rng.weighted on an empty list');
      const weights = items.map(weight);
      const total = weights.reduce((sum, w) => sum + w, 0);
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!;
        if (roll < 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
