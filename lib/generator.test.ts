import { describe, expect, it } from "vitest";
import { generateRange, generateRequests, MINUTE_MS } from "./generator";
import { computeCost, MODELS } from "./models";
import type { LLMRequest } from "./types";

const SEED = 7;
const RATE = 10;
const BASE = 1_760_000_000_000 - (1_760_000_000_000 % MINUTE_MS);

const ids = (rows: LLMRequest[]) => rows.map((r) => r.id);

describe("generateRange determinism", () => {
  it("is reproducible for the same range and seed", () => {
    const a = generateRange({ from: BASE, to: BASE + 30 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const b = generateRange({ from: BASE, to: BASE + 30 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
  });

  it("produces a different stream for a different seed", () => {
    const a = generateRange({ from: BASE, to: BASE + 30 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const b = generateRange({ from: BASE, to: BASE + 30 * MINUTE_MS, ratePerMin: RATE, seed: SEED + 1 });
    expect(a).not.toEqual(b);
  });

  /**
   * The property the whole live-ingestion path rests on. If splitting a range
   * changed its contents, incrementally appending elapsed time would drift away
   * from what a full backfill produces, and the dashboard would show different
   * history depending on how long the process had been running.
   */
  it("is invariant under splitting at a minute boundary", () => {
    const whole = generateRange({ from: BASE, to: BASE + 20 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const first = generateRange({ from: BASE, to: BASE + 7 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const rest = generateRange({ from: BASE + 7 * MINUTE_MS, to: BASE + 20 * MINUTE_MS, ratePerMin: RATE, seed: SEED });

    expect([...first, ...rest]).toEqual(whole);
  });

  it("is invariant under splitting mid-minute", () => {
    // Ingestion ticks every few seconds, so splits land inside a minute far
    // more often than on its boundary.
    const cut = BASE + 3 * MINUTE_MS + 17_384;
    const whole = generateRange({ from: BASE, to: BASE + 10 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const first = generateRange({ from: BASE, to: cut, ratePerMin: RATE, seed: SEED });
    const rest = generateRange({ from: cut, to: BASE + 10 * MINUTE_MS, ratePerMin: RATE, seed: SEED });

    expect([...first, ...rest]).toEqual(whole);
  });

  it("survives being split into many small slices", () => {
    const to = BASE + 5 * MINUTE_MS;
    const whole = generateRange({ from: BASE, to, ratePerMin: RATE, seed: SEED });

    const slices: LLMRequest[] = [];
    const step = 7_000; // deliberately not a divisor of a minute
    for (let t = BASE; t < to; t += step) {
      slices.push(
        ...generateRange({ from: t, to: Math.min(t + step, to), ratePerMin: RATE, seed: SEED }),
      );
    }
    expect(slices).toEqual(whole);
  });

  it("emits no duplicate ids across a long range", () => {
    const rows = generateRange({ from: BASE, to: BASE + 6 * 60 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    expect(new Set(ids(rows)).size).toBe(rows.length);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(generateRange({ from: BASE, to: BASE, ratePerMin: RATE, seed: SEED })).toEqual([]);
    expect(generateRange({ from: BASE, to: BASE - 1000, ratePerMin: RATE, seed: SEED })).toEqual([]);
  });
});

describe("generated events are well-formed", () => {
  const rows = generateRange({ from: BASE, to: BASE + 60 * MINUTE_MS, ratePerMin: RATE, seed: SEED });

  it("keeps every timestamp inside the requested range", () => {
    for (const r of rows) {
      expect(r.timestamp).toBeGreaterThanOrEqual(BASE);
      expect(r.timestamp).toBeLessThan(BASE + 60 * MINUTE_MS);
    }
  });

  it("emits events in chronological order", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].timestamp).toBeGreaterThanOrEqual(rows[i - 1].timestamp);
    }
  });

  it("never caches more input than was sent", () => {
    for (const r of rows) {
      expect(r.cachedTokens).toBeLessThanOrEqual(r.inputTokens);
      expect(r.cachedTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("bills no output tokens for failed requests", () => {
    for (const r of rows) {
      if (r.status !== "success") expect(r.outputTokens).toBe(0);
    }
  });

  it("scores failed requests as zero quality and successes within range", () => {
    for (const r of rows) {
      if (r.status !== "success") expect(r.qualityScore).toBe(0);
      else {
        expect(r.qualityScore).toBeGreaterThan(0);
        expect(r.qualityScore).toBeLessThanOrEqual(1);
      }
    }
  });

  it("agrees with the price book on every request", () => {
    for (const r of rows) {
      expect(r.costUsd).toBeCloseTo(
        computeCost(r.model, r.inputTokens, r.outputTokens, r.cachedTokens),
        12,
      );
    }
  });

  it("only emits known models and endpoints", () => {
    const models = new Set(Object.keys(MODELS));
    for (const r of rows) {
      expect(models.has(r.model)).toBe(true);
      expect(["chat", "classify", "summarize", "rag"]).toContain(r.endpoint);
    }
  });
});

describe("traffic shape", () => {
  it("follows a diurnal curve rather than a flat rate", () => {
    // A full day at a fixed nominal rate. If the diurnal factor were not
    // applied, every hour would carry roughly the same volume.
    const day = generateRange({ from: BASE, to: BASE + 24 * 60 * MINUTE_MS, ratePerMin: RATE, seed: SEED });
    const perHour = new Array(24).fill(0);
    for (const r of day) perHour[Math.floor((r.timestamp - BASE) / 3600_000)]++;

    const busiest = Math.max(...perHour);
    const quietest = Math.min(...perHour);
    expect(busiest / quietest).toBeGreaterThan(1.5);
  });

  it("scales volume with the requested rate", () => {
    const slow = generateRange({ from: BASE, to: BASE + 60 * MINUTE_MS, ratePerMin: 4, seed: SEED });
    const fast = generateRange({ from: BASE, to: BASE + 60 * MINUTE_MS, ratePerMin: 40, seed: SEED });
    expect(fast.length / slow.length).toBeGreaterThan(5);
  });
});

describe("incidents", () => {
  // Long enough to span several 6-hour incident blocks.
  const week = generateRange({
    from: BASE,
    to: BASE + 7 * 24 * 60 * MINUTE_MS,
    ratePerMin: RATE,
    seed: SEED,
  });

  /** Roll the stream up into fixed buckets, the way the dashboard does. */
  function buckets(rows: LLMRequest[], sizeMs: number) {
    const map = new Map<number, LLMRequest[]>();
    for (const r of rows) {
      const key = Math.floor((r.timestamp - BASE) / sizeMs);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  it("produces error bursts that survive 30-minute bucketing", () => {
    // The whole point: at dashboard resolution there must be buckets whose
    // error rate is far above the ambient ~2.5%, or the anomaly panel has
    // nothing real to detect.
    const rates = buckets(week, 30 * MINUTE_MS)
      .filter((b) => b.length >= 20)
      .map((b) => b.filter((r) => r.status !== "success").length / b.length);

    expect(Math.max(...rates)).toBeGreaterThan(0.1);
    // ...while the typical bucket stays healthy.
    const sorted = [...rates].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(0.06);
  });

  it("produces latency degradations visible in bucketed p95", () => {
    const p95s = buckets(week, 30 * MINUTE_MS)
      .filter((b) => b.length >= 20)
      .map((b) => {
        const l = b.map((r) => r.latencyMs).sort((a, x) => a - x);
        return l[Math.floor(l.length * 0.95)];
      });
    const sorted = [...p95s].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(Math.max(...p95s)).toBeGreaterThan(median * 2);
  });

  it("produces cost spikes visible in bucketed spend", () => {
    const costs = buckets(week, 30 * MINUTE_MS)
      .filter((b) => b.length >= 20)
      .map((b) => b.reduce((s, r) => s + r.costUsd, 0));
    const sorted = [...costs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(Math.max(...costs)).toBeGreaterThan(median * 2);
  });

  it("leaves most of the week ordinary", () => {
    // Incidents must be the exception. If most buckets were degraded, the
    // "baseline" the detector learns would itself be the incident.
    const rates = buckets(week, 30 * MINUTE_MS)
      .filter((b) => b.length >= 20)
      .map((b) => b.filter((r) => r.status !== "success").length / b.length);
    const calm = rates.filter((r) => r < 0.08).length;
    expect(calm / rates.length).toBeGreaterThan(0.7);
  });

  it("stays deterministic and chunk-independent despite incidents", () => {
    // Incidents are derived from the clock, not accumulated state, so slicing
    // the range must still be invisible.
    const cut = BASE + 3 * 24 * 60 * MINUTE_MS + 91_337;
    const to = BASE + 7 * 24 * 60 * MINUTE_MS;
    const first = generateRange({ from: BASE, to: cut, ratePerMin: RATE, seed: SEED });
    const rest = generateRange({ from: cut, to, ratePerMin: RATE, seed: SEED });
    expect([...first, ...rest]).toEqual(week);
  });
});

describe("generateRequests wrapper", () => {
  it("covers exactly the trailing window", () => {
    const now = BASE + 500 * MINUTE_MS;
    const viaWrapper = generateRequests({ now, windowHours: 2, ratePerMin: RATE, seed: SEED });
    const viaRange = generateRange({
      from: now - 2 * 3600_000,
      to: now,
      ratePerMin: RATE,
      seed: SEED,
    });
    expect(viaWrapper).toEqual(viaRange);
  });
});
