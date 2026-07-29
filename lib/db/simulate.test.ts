import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createTestStore } from "./client";
import { BASELINE_SCENARIO, parseScenario, simulate } from "./simulate";
import { NO_FILTERS, type TimeRange } from "./filters";
import { MODEL_IDS } from "../models";

const TO_MS = 1_760_000_000_000;
const FROM_MS = TO_MS - 24 * 3600_000;
const RANGE: TimeRange = { fromMs: FROM_MS, toMs: TO_MS };

let store: Awaited<ReturnType<typeof createTestStore>>;

beforeAll(async () => {
  store = await createTestStore(FROM_MS, TO_MS, { ratePerMin: 6, seed: 2024 });
});

afterAll(() => {
  store?.connection.closeSync();
  store?.instance.closeSync();
});

const run = (scenario: Parameters<typeof simulate>[3]) =>
  simulate(store.connection, RANGE, NO_FILTERS, scenario);

describe("the empty scenario is a no-op", () => {
  it("re-prices to exactly the observed spend", async () => {
    const r = await run(BASELINE_SCENARIO);
    // If re-pricing the baseline did not reproduce the baseline, every other
    // number the simulator reports would be built on a broken foundation.
    expect(r.scenarioMonthlyUsd).toBeCloseTo(r.baselineMonthlyUsd, 6);
    expect(r.deltaUsd).toBeCloseTo(0, 6);
    expect(r.deltaPct).toBeCloseTo(0, 6);
  });

  it("moves no requests and changes no quality", async () => {
    const r = await run(BASELINE_SCENARIO);
    expect(r.movedRequests).toBe(0);
    expect(r.totalRequests).toBeGreaterThan(5_000);
    expect(r.scenarioQuality).toBeCloseTo(r.baselineQuality, 10);
  });

  it("reports per-model figures identical on both sides", async () => {
    const r = await run(BASELINE_SCENARIO);
    for (const row of r.byModel) {
      expect(row.scenarioUsd, row.model).toBeCloseTo(row.baselineUsd, 8);
      expect(row.scenarioRequests, row.model).toBe(row.baselineRequests);
    }
  });
});

describe("routing overrides", () => {
  it("moves the requested share, deterministically", async () => {
    const scenario = {
      routing: [{ endpoint: "chat" as const, targetModel: "gpt-4o-mini" as const, share: 0.5 }],
      cacheHitRate: null,
      trafficMultiplier: 1,
    };
    const a = await run(scenario);
    const b = await run(scenario);

    expect(a.movedRequests).toBeGreaterThan(0);
    // Same scenario, same answer — sliders must not reshuffle the split.
    expect(b.movedRequests).toBe(a.movedRequests);
    expect(b.scenarioMonthlyUsd).toBeCloseTo(a.scenarioMonthlyUsd, 10);
  });

  it("moves more traffic as the share rises", async () => {
    const at = async (share: number) =>
      (
        await run({
          routing: [{ endpoint: "chat", targetModel: "gpt-4o-mini", share }],
          cacheHitRate: null,
          trafficMultiplier: 1,
        })
      ).movedRequests;

    const [quarter, half, all] = await Promise.all([at(0.25), at(0.5), at(1)]);
    expect(quarter).toBeLessThan(half);
    expect(half).toBeLessThan(all);
  });

  it("cuts cost and quality when moving to a cheaper model", async () => {
    const r = await run({
      routing: [{ endpoint: "chat", targetModel: "gpt-4o-mini", share: 1 }],
      cacheHitRate: null,
      trafficMultiplier: 1,
    });

    expect(r.scenarioMonthlyUsd).toBeLessThan(r.baselineMonthlyUsd);
    expect(r.deltaUsd).toBeLessThan(0);
    // The trade-off must show up rather than being hidden.
    expect(r.scenarioQuality).toBeLessThan(r.baselineQuality);
  });

  it("raises cost when moving to a pricier model", async () => {
    const r = await run({
      routing: [{ endpoint: "classify", targetModel: "claude-sonnet-5", share: 1 }],
      cacheHitRate: null,
      trafficMultiplier: 1,
    });
    expect(r.scenarioMonthlyUsd).toBeGreaterThan(r.baselineMonthlyUsd);
    expect(r.deltaUsd).toBeGreaterThan(0);
  });

  it("leaves other endpoints untouched", async () => {
    const r = await run({
      routing: [{ endpoint: "classify", targetModel: "gpt-4o-mini", share: 1 }],
      cacheHitRate: null,
      trafficMultiplier: 1,
    });
    const baseline = await run(BASELINE_SCENARIO);
    // Only classify traffic moved, so the total request count is unchanged.
    expect(r.totalRequests).toBe(baseline.totalRequests);
    expect(r.movedRequests).toBeLessThan(r.totalRequests);
  });
});

describe("cache hit rate", () => {
  it("is cheaper at full cache than at none", async () => {
    const cold = await run({ routing: [], cacheHitRate: 0, trafficMultiplier: 1 });
    const warm = await run({ routing: [], cacheHitRate: 1, trafficMultiplier: 1 });
    expect(warm.scenarioMonthlyUsd).toBeLessThan(cold.scenarioMonthlyUsd);
  });

  it("never bills more cached tokens than were sent", async () => {
    // A 100% hit rate must clamp to input_tokens, not exceed it — otherwise the
    // saving would be overstated on every request.
    const warm = await run({ routing: [], cacheHitRate: 1, trafficMultiplier: 1 });
    expect(warm.scenarioMonthlyUsd).toBeGreaterThan(0);
    expect(warm.scenarioMonthlyUsd).toBeLessThan(warm.baselineMonthlyUsd);
  });

  it("does not change quality", async () => {
    const r = await run({ routing: [], cacheHitRate: 0.9, trafficMultiplier: 1 });
    // A cache hit returns the identical completion.
    expect(r.scenarioQuality).toBeCloseTo(r.baselineQuality, 10);
  });
});

describe("traffic multiplier", () => {
  it("scales projected spend linearly", async () => {
    const base = await run(BASELINE_SCENARIO);
    const triple = await run({ routing: [], cacheHitRate: null, trafficMultiplier: 3 });
    expect(triple.scenarioMonthlyUsd).toBeCloseTo(base.scenarioMonthlyUsd * 3, 6);
  });

  it("leaves the baseline alone", async () => {
    const base = await run(BASELINE_SCENARIO);
    const triple = await run({ routing: [], cacheHitRate: null, trafficMultiplier: 3 });
    // The comparison point is today's spend, not a scaled version of it.
    expect(triple.baselineMonthlyUsd).toBeCloseTo(base.baselineMonthlyUsd, 6);
  });
});

describe("parseScenario rejects anything it does not recognise", () => {
  it("drops unknown endpoints and models", () => {
    const s = parseScenario({
      routing: [
        { endpoint: "chat", targetModel: "gpt-4o-mini", share: 0.5 },
        { endpoint: "not-an-endpoint", targetModel: "gpt-4o-mini", share: 1 },
        { endpoint: "rag", targetModel: "gpt-5-imaginary", share: 1 },
      ],
    });
    expect(s.routing).toHaveLength(1);
    expect(s.routing[0].endpoint).toBe("chat");
  });

  it("clamps shares and the traffic multiplier into range", () => {
    const s = parseScenario({
      routing: [{ endpoint: "rag", targetModel: "gpt-4o", share: 99 }],
      trafficMultiplier: 10_000,
    });
    expect(s.routing[0].share).toBe(1);
    expect(s.trafficMultiplier).toBe(10);
  });

  it("drops zero-share overrides", () => {
    const s = parseScenario({
      routing: [{ endpoint: "rag", targetModel: "gpt-4o", share: 0 }],
    });
    expect(s.routing).toHaveLength(0);
  });

  it("keeps one override per endpoint", () => {
    const s = parseScenario({
      routing: [
        { endpoint: "rag", targetModel: "gpt-4o", share: 0.3 },
        { endpoint: "rag", targetModel: "gpt-4o-mini", share: 0.9 },
      ],
    });
    expect(s.routing).toHaveLength(1);
    expect(s.routing[0].targetModel).toBe("gpt-4o");
  });

  it("survives garbage input without throwing", () => {
    expect(parseScenario(null)).toEqual(BASELINE_SCENARIO);
    expect(parseScenario({ routing: "not an array" }).routing).toEqual([]);
    expect(parseScenario({ trafficMultiplier: "abc" }).trafficMultiplier).toBe(0.1);
    expect(parseScenario({ cacheHitRate: "xyz" }).cacheHitRate).toBe(0);
  });

  it("accepts every known model as a target", () => {
    for (const model of MODEL_IDS) {
      const s = parseScenario({
        routing: [{ endpoint: "chat", targetModel: model, share: 0.5 }],
      });
      expect(s.routing[0].targetModel).toBe(model);
    }
  });
});
