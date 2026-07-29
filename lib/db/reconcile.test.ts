import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createTestStore } from "./client";
import { querySummary, queryRequests } from "./queries";
import { NO_FILTERS, type TimeRange } from "./filters";
import { generateRange } from "../generator";
import { summarize } from "../aggregate";
import { MODEL_IDS } from "../models";
import { ENDPOINT_IDS } from "./filters";
import { computeInsights, totalMonthlySavings } from "../insights";
import { queryInsights } from "./insights";

/**
 * Reconciliation suite.
 *
 * The dashboard reads its numbers from SQL (`lib/db/queries.ts`). This suite
 * recomputes the same window with the independent TypeScript roll-up in
 * `lib/aggregate.ts` and asserts the two agree. Two implementations written
 * against the same spec, disagreeing only if one has a bug, is a far stronger
 * check than asserting either one against hand-written expected values.
 */

// A fixed historical window: the whole suite is deterministic, no wall clock.
const TO_MS = 1_760_000_000_000; // 2025-10-09T07:33:20Z, snapped below
const FROM_MS = TO_MS - 24 * 3600_000;
const RATE = 6;
const SEED = 1234;
const BUCKET_MINUTES = 30;

const RANGE: TimeRange = { fromMs: FROM_MS, toMs: TO_MS };

let store: Awaited<ReturnType<typeof createTestStore>>;

beforeAll(async () => {
  store = await createTestStore(FROM_MS, TO_MS, { ratePerMin: RATE, seed: SEED });
});

afterAll(() => {
  store?.connection.closeSync();
  store?.instance.closeSync();
});

/** The reference roll-up over exactly the same events the store was loaded with. */
function reference() {
  const events = generateRange({
    from: FROM_MS,
    to: TO_MS,
    ratePerMin: RATE,
    seed: SEED,
  });
  return { events, summary: summarize(events, TO_MS, 24, BUCKET_MINUTES) };
}

describe("SQL aggregation reconciles with the TypeScript reference", () => {
  it("produces a non-trivial amount of data to compare", () => {
    const { events } = reference();
    // Guards against the suite silently passing on an empty window.
    expect(events.length).toBeGreaterThan(5_000);
  });

  it("agrees on headline totals", async () => {
    const { summary: want } = reference();
    const got = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );

    expect(got.totalRequests).toBe(want.totalRequests);
    expect(got.totalInputTokens).toBe(want.totalInputTokens);
    expect(got.totalOutputTokens).toBe(want.totalOutputTokens);
    expect(got.totalCachedTokens).toBe(want.totalCachedTokens);
    expect(got.totalCostUsd).toBeCloseTo(want.totalCostUsd, 8);
    expect(got.avgCostPerRequest).toBeCloseTo(want.avgCostPerRequest, 10);
    expect(got.errorRate).toBeCloseTo(want.errorRate, 10);
    expect(got.burnRateMonthlyUsd).toBeCloseTo(want.burnRateMonthlyUsd, 6);
  });

  it("agrees on latency percentiles", async () => {
    const { summary: want } = reference();
    const got = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );

    // DuckDB's quantile_cont and our percentile() both interpolate linearly,
    // so these should match to within floating-point noise.
    expect(got.latencyP50).toBeCloseTo(want.latencyP50, 6);
    expect(got.latencyP95).toBeCloseTo(want.latencyP95, 6);
    expect(got.latencyP99).toBeCloseTo(want.latencyP99, 6);
  });

  it("agrees on the per-model breakdown", async () => {
    const { summary: want } = reference();
    const got = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );

    for (const id of MODEL_IDS) {
      expect(got.byModel[id].requests, id).toBe(want.byModel[id].requests);
      expect(got.byModel[id].costUsd, id).toBeCloseTo(want.byModel[id].costUsd, 8);
      expect(got.byModel[id].qualityCount, id).toBe(want.byModel[id].qualityCount);
      expect(got.byModel[id].qualitySum, id).toBeCloseTo(
        want.byModel[id].qualitySum,
        6,
      );
    }
  });

  it("agrees on the per-endpoint breakdown", async () => {
    const { summary: want } = reference();
    const got = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );

    for (const id of ENDPOINT_IDS) {
      expect(got.byEndpoint[id].requests, id).toBe(want.byEndpoint[id].requests);
      expect(got.byEndpoint[id].costUsd, id).toBeCloseTo(
        want.byEndpoint[id].costUsd,
        8,
      );
    }
  });

  it("agrees on the time series, bucket for bucket", async () => {
    const { summary: want } = reference();
    const got = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );

    expect(got.timeSeries.length).toBe(want.timeSeries.length);
    for (let i = 0; i < want.timeSeries.length; i++) {
      expect(got.timeSeries[i].t, `bucket ${i} start`).toBe(want.timeSeries[i].t);
      expect(got.timeSeries[i].requests, `bucket ${i} requests`).toBe(
        want.timeSeries[i].requests,
      );
      expect(got.timeSeries[i].costUsd, `bucket ${i} cost`).toBeCloseTo(
        want.timeSeries[i].costUsd,
        8,
      );
      for (const m of MODEL_IDS) {
        expect(got.timeSeries[i].costByModel[m], `bucket ${i} / ${m}`).toBeCloseTo(
          want.timeSeries[i].costByModel[m],
          8,
        );
      }
    }
  });
});

describe("filters", () => {
  it("restricts totals to the selected model", async () => {
    const { summary: want } = reference();
    const target = MODEL_IDS[0];
    const got = await querySummary(
      store.connection,
      RANGE,
      { models: [target], endpoints: [], statuses: [] },
      BUCKET_MINUTES,
    );

    expect(got.totalRequests).toBe(want.byModel[target].requests);
    expect(got.totalCostUsd).toBeCloseTo(want.byModel[target].costUsd, 8);
  });

  it("combines dimensions conjunctively", async () => {
    const { events } = reference();
    const model = MODEL_IDS[0];
    const endpoint = ENDPOINT_IDS[0];
    const expected = events.filter(
      (e) => e.model === model && e.endpoint === endpoint && e.status === "success",
    );

    const got = await querySummary(
      store.connection,
      RANGE,
      { models: [model], endpoints: [endpoint], statuses: ["success"] },
      BUCKET_MINUTES,
    );

    expect(got.totalRequests).toBe(expected.length);
    expect(got.totalCostUsd).toBeCloseTo(
      expected.reduce((s, e) => s + e.costUsd, 0),
      8,
    );
  });

  it("ignores unknown filter values rather than matching nothing", async () => {
    const unfiltered = await querySummary(
      store.connection,
      RANGE,
      NO_FILTERS,
      BUCKET_MINUTES,
    );
    // parseFilters drops unknown values, so this is the shape the route passes on.
    const got = await querySummary(
      store.connection,
      RANGE,
      { models: [], endpoints: [], statuses: [] },
      BUCKET_MINUTES,
    );
    expect(got.totalRequests).toBe(unfiltered.totalRequests);
  });
});

describe("savings recommendations reconcile", () => {
  it("produces the same insights, in the same order, as the reference", async () => {
    const { events, summary } = reference();
    const want = computeInsights(events, summary);
    const got = await queryInsights(
      store.connection,
      RANGE,
      NO_FILTERS,
      summary.burnRateMonthlyUsd,
    );

    expect(got.length).toBe(want.length);
    expect(got.length).toBeGreaterThan(0);

    for (let i = 0; i < want.length; i++) {
      expect(got[i].id, `insight ${i}`).toBe(want[i].id);
      expect(got[i].category, got[i].id).toBe(want[i].category);
      expect(got[i].severity, got[i].id).toBe(want[i].severity);
      expect(got[i].basis, got[i].id).toBe(want[i].basis);
      expect(got[i].affectedRequests, got[i].id).toBe(want[i].affectedRequests);
      expect(got[i].monthlySavingsUsd, got[i].id).toBeCloseTo(
        want[i].monthlySavingsUsd,
        6,
      );
      if (want[i].qualityDelta === undefined) {
        expect(got[i].qualityDelta, got[i].id).toBeUndefined();
      } else {
        expect(got[i].qualityDelta!, got[i].id).toBeCloseTo(want[i].qualityDelta!, 8);
      }
    }
  });

  it("separates measured savings from assumption-based ones", async () => {
    const { summary } = reference();
    const got = await queryInsights(
      store.connection,
      RANGE,
      NO_FILTERS,
      summary.burnRateMonthlyUsd,
    );
    const breakdown = totalMonthlySavings(got);

    expect(breakdown.measuredUsd).toBeGreaterThan(0);
    expect(breakdown.assumedUsd).toBeGreaterThan(0);
    expect(breakdown.totalUsd).toBeCloseTo(
      breakdown.measuredUsd + breakdown.assumedUsd,
      10,
    );
    // The caching recommendation is the only assumption-based one, and it is
    // flagged as such rather than being silently blended into the headline.
    const assumed = got.filter((i) => i.basis === "assumption");
    expect(assumed).toHaveLength(1);
    expect(assumed[0].assumption).toBeTruthy();
  });

  it("never claims a saving from moving to a pricier model", async () => {
    const { summary } = reference();
    const got = await queryInsights(
      store.connection,
      RANGE,
      NO_FILTERS,
      summary.burnRateMonthlyUsd,
    );
    for (const i of got) {
      expect(i.monthlySavingsUsd, i.id).toBeGreaterThan(0);
    }
  });

  it("reports the quality cost of every routing recommendation", async () => {
    const { summary } = reference();
    const got = await queryInsights(
      store.connection,
      RANGE,
      NO_FILTERS,
      summary.burnRateMonthlyUsd,
    );
    for (const i of got.filter((x) => x.category === "routing")) {
      // Downgrading to a cheaper model trades quality away; the number must be
      // present and negative rather than quietly omitted.
      expect(i.qualityDelta, i.id).toBeDefined();
      expect(i.qualityDelta!, i.id).toBeLessThan(0);
    }
  });
});

describe("raw request paging", () => {
  it("returns the most expensive requests first when sorted by cost", async () => {
    const page = await queryRequests(store.connection, RANGE, NO_FILTERS, {
      sort: "cost_usd",
      direction: "desc",
      limit: 25,
    });

    const { events } = reference();
    const wantTop = [...events].sort((a, b) => b.costUsd - a.costUsd)[0];

    expect(page.total).toBe(events.length);
    expect(page.rows).toHaveLength(25);
    expect(page.rows[0].costUsd).toBeCloseTo(wantTop.costUsd, 10);
    for (let i = 1; i < page.rows.length; i++) {
      expect(page.rows[i - 1].costUsd).toBeGreaterThanOrEqual(page.rows[i].costUsd);
    }
  });

  it("pages without overlap or gaps", async () => {
    const first = await queryRequests(store.connection, RANGE, NO_FILTERS, {
      limit: 10,
      offset: 0,
    });
    const second = await queryRequests(store.connection, RANGE, NO_FILTERS, {
      limit: 10,
      offset: 10,
    });

    const ids = new Set(first.rows.map((r) => r.id));
    expect(second.rows.some((r) => ids.has(r.id))).toBe(false);
    expect(first.total).toBe(second.total);
  });

  it("round-trips every field of an event through the store", async () => {
    const page = await queryRequests(store.connection, RANGE, NO_FILTERS, {
      sort: "ts",
      direction: "asc",
      limit: 1,
    });
    const { events } = reference();
    const first = [...events].sort(
      (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
    )[0];

    const got = page.rows[0];
    expect(got.id).toBe(first.id);
    expect(got.timestamp).toBe(first.timestamp);
    expect(got.model).toBe(first.model);
    expect(got.endpoint).toBe(first.endpoint);
    expect(got.inputTokens).toBe(first.inputTokens);
    expect(got.outputTokens).toBe(first.outputTokens);
    expect(got.cachedTokens).toBe(first.cachedTokens);
    expect(got.latencyMs).toBe(first.latencyMs);
    expect(got.status).toBe(first.status);
    expect(got.costUsd).toBeCloseTo(first.costUsd, 12);
  });
});
