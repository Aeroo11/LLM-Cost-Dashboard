/**
 * Seeded pseudo-random primitives.
 *
 * Everything downstream (the event generator) is built on a seeded PRNG so the
 * simulated data is *reproducible* — same seed + same window ⇒ identical stream.
 * That matters for two reasons:
 *   1. No React hydration mismatch (server and client agree on the data).
 *   2. Distributions look realistic (log-normal latencies, Poisson arrivals)
 *      instead of the flat, obviously-fake spread you get from Math.random().
 */

/** mulberry32 — tiny, fast, well-distributed 32-bit PRNG. Returns [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal (mean 0, sd 1) via Box–Muller. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Log-normal sample. `mu`/`sigma` are in *log space*. Great for quantities that
 * are strictly positive and right-skewed — token counts and latencies both are.
 */
export function lognormal(rng: () => number, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * gaussian(rng));
}

/** Exponential inter-arrival time for a Poisson process of the given rate. */
export function exponential(rng: () => number, rate: number): number {
  return -Math.log(1 - rng()) / rate;
}

/** Pick one item from [value, weight] pairs, proportional to weight. */
export function weightedPick<T>(rng: () => number, items: Array<[T, number]>): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [value, weight] of items) {
    r -= weight;
    if (r <= 0) return value;
  }
  return items[items.length - 1][0];
}

/** Bounded, rounded integer helper for token counts. */
export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
