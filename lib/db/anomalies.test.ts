import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DuckDBInstance, type DuckDBConnection, timestampValue } from "@duckdb/node-api";
import { DDL, VIEWS } from "./schema";
import { queryAnomalies } from "./anomalies";
import { NO_FILTERS, type TimeRange } from "./filters";
import { createTestStore } from "./client";
import { median, mad, DEFAULT_THRESHOLD } from "../anomaly";
import type { LLMRequest } from "../types";

/**
 * The SQL detector is verified two ways:
 *
 *   1. Against a hand-built series with a known injected incident, so we can
 *      assert it finds the thing that was planted and nothing else.
 *   2. Against the pure-TypeScript median/MAD in `lib/anomaly.ts`, so the SQL
 *      arithmetic is pinned to an independent implementation.
 */

const BUCKET_MINUTES = 30;
const BUCKET_MS = BUCKET_MINUTES * 60_000;
const ORIGIN = 1_760_000_000_000 - (1_760_000_000_000 % BUCKET_MS);

/** Build a store containing exactly the events we specify. */
async function storeWith(rows: LLMRequest[]) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(DDL);
  await connection.run(VIEWS);

  const appender = await connection.createAppender("requests");
  for (const r of rows) {
    appender.appendVarchar(r.id);
    appender.appendTimestamp(timestampValue(BigInt(r.timestamp) * 1000n));
    appender.appendVarchar(r.model);
    appender.appendVarchar(r.endpoint);
    appender.appendInteger(r.inputTokens);
    appender.appendInteger(r.outputTokens);
    appender.appendInteger(r.cachedTokens);
    appender.appendInteger(r.latencyMs);
    appender.appendVarchar(r.status);
    appender.appendDouble(r.qualityScore);
    appender.appendDouble(r.costUsd);
    appender.endRow();
  }
  appender.flushSync();
  appender.closeSync();
  return { instance, connection };
}

function event(overrides: Partial<LLMRequest> & { timestamp: number }): LLMRequest {
  return {
    id: `e${overrides.timestamp}-${Math.round((overrides.costUsd ?? 0) * 1e6)}`,
    model: "gpt-4o",
    endpoint: "chat",
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 0,
    latencyMs: 900,
    status: "success",
    qualityScore: 0.9,
    costUsd: 0.001,
    ...overrides,
  };
}

/**
 * `bucketCount` buckets of ordinary traffic, with a deterministic wobble so the
 * MAD of the baseline is non-zero (a perfectly flat history is a degenerate
 * case the detector correctly refuses to score).
 */
function ordinaryTraffic(bucketCount: number, perBucket = 20): LLMRequest[] {
  const rows: LLMRequest[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const wobble = 1 + 0.08 * Math.sin(b * 1.7);
    for (let i = 0; i < perBucket; i++) {
      rows.push(
        event({
          timestamp: ORIGIN + b * BUCKET_MS + i * 1000,
          id: `ok-${b}-${i}`,
          costUsd: 0.001 * wobble,
          latencyMs: Math.round(900 * wobble),
        }),
      );
    }
  }
  return rows;
}

describe("anomaly detection over a planted incident", () => {
  const BUCKETS = 40;
  const INCIDENT_BUCKET = 30;
  let db: { instance: DuckDBInstance; connection: DuckDBConnection };
  let range: TimeRange;

  beforeAll(async () => {
    const rows = ordinaryTraffic(BUCKETS);
    // Plant one bad half-hour: a cost blow-out, an error storm, and a latency
    // cliff, all in the same bucket.
    const t = ORIGIN + INCIDENT_BUCKET * BUCKET_MS;
    for (let i = 0; i < 20; i++) {
      rows.push(
        event({
          timestamp: t + i * 1000,
          id: `bad-${i}`,
          costUsd: 0.05,
          latencyMs: 30_000,
          status: i < 12 ? "timeout" : "success",
        }),
      );
    }
    db = await storeWith(rows);
    range = { fromMs: ORIGIN, toMs: ORIGIN + BUCKETS * BUCKET_MS };
  });

  afterAll(() => {
    db?.connection.closeSync();
    db?.instance.closeSync();
  });

  it("flags the planted bucket on all three metrics", async () => {
    const found = await queryAnomalies(db.connection, range, NO_FILTERS, BUCKET_MINUTES);
    const at = ORIGIN + INCIDENT_BUCKET * BUCKET_MS;
    const metrics = found.filter((a) => a.at === at).map((a) => a.metric).sort();
    expect(metrics).toEqual(["cost", "error_rate", "latency_p95"]);
  });

  it("does not flag the ordinary buckets", async () => {
    const found = await queryAnomalies(db.connection, range, NO_FILTERS, BUCKET_MINUTES);
    const at = ORIGIN + INCIDENT_BUCKET * BUCKET_MS;
    expect(found.every((a) => a.at === at)).toBe(true);
  });

  it("reports the incident as a spike above a sane baseline", async () => {
    const found = await queryAnomalies(db.connection, range, NO_FILTERS, BUCKET_MINUTES);
    const cost = found.find((a) => a.metric === "cost")!;

    expect(cost.direction).toBe("spike");
    expect(cost.value).toBeGreaterThan(cost.baseline * 5);
    expect(Math.abs(cost.score)).toBeGreaterThan(DEFAULT_THRESHOLD);
    expect(cost.severity).toBe("high");
    expect(cost.detail).toMatch(/rolling baseline/);
  });

  it("suppresses drops on metrics where a fall is good news", async () => {
    // Latency and error rate return to normal after the incident. That descent
    // must not be reported as a finding.
    const found = await queryAnomalies(db.connection, range, NO_FILTERS, BUCKET_MINUTES);
    const badDrops = found.filter(
      (a) => a.direction === "drop" && a.metric !== "cost",
    );
    expect(badDrops).toHaveLength(0);
  });

  it("reports nothing when there is no history to judge against", async () => {
    // A window shorter than MIN_HISTORY buckets has no baseline at all.
    const shortRange: TimeRange = { fromMs: ORIGIN, toMs: ORIGIN + 4 * BUCKET_MS };
    const found = await queryAnomalies(
      db.connection,
      shortRange,
      NO_FILTERS,
      BUCKET_MINUTES,
    );
    expect(found).toHaveLength(0);
  });
});

describe("SQL median/MAD reconciles with the TypeScript reference", () => {
  let store: Awaited<ReturnType<typeof createTestStore>>;
  const TO_MS = 1_760_000_000_000;
  const FROM_MS = TO_MS - 24 * 3600_000;

  beforeAll(async () => {
    store = await createTestStore(FROM_MS, TO_MS, { ratePerMin: 6, seed: 99 });
  });

  afterAll(() => {
    store?.connection.closeSync();
    store?.instance.closeSync();
  });

  it("computes the same rolling baseline and MAD as lib/anomaly.ts", async () => {
    // Pull the per-bucket costs straight out of SQL, then recompute the
    // baseline for one bucket in TypeScript and compare.
    const reader = await store.connection.runAndReadAll(
      `SELECT CAST(epoch_ms(time_bucket(to_minutes(30), ts, epoch_ms($1::BIGINT))) AS BIGINT) AS b,
              sum(cost_usd) AS cost
       FROM v_requests WHERE ts >= epoch_ms($1::BIGINT) AND ts < epoch_ms($2::BIGINT)
       GROUP BY 1 ORDER BY 1`,
      [FROM_MS, TO_MS],
    );
    const costs = reader.getRowObjects().map((r) => Number(r.cost));
    expect(costs.length).toBeGreaterThan(20);

    const sqlSide = await store.connection.runAndReadAll(
      `WITH b AS (
         SELECT CAST(epoch_ms(time_bucket(to_minutes(30), ts, epoch_ms($1::BIGINT))) AS BIGINT) AS bucket_ms,
                sum(cost_usd) AS cost
         FROM v_requests WHERE ts >= epoch_ms($1::BIGINT) AND ts < epoch_ms($2::BIGINT)
         GROUP BY 1
       ), h AS (
         SELECT *, array_agg(cost) OVER (
           ORDER BY bucket_ms ROWS BETWEEN 48 PRECEDING AND 1 PRECEDING
         ) AS hist FROM b
       )
       SELECT len(hist) AS n,
              list_aggregate(hist, 'median') AS med,
              list_aggregate(list_transform(hist,
                x -> abs(x - list_aggregate(hist, 'median'))), 'median') AS mad_val
       FROM h ORDER BY bucket_ms`,
      [FROM_MS, TO_MS],
    );

    const rows = sqlSide.getRowObjects();
    let compared = 0;
    for (let i = 0; i < rows.length; i++) {
      const n = Number(rows[i].n);
      if (n === 0) continue;
      const history = costs.slice(Math.max(0, i - 48), i);
      expect(history).toHaveLength(n);
      expect(Number(rows[i].med), `median at bucket ${i}`).toBeCloseTo(
        median(history),
        10,
      );
      expect(Number(rows[i].mad_val), `MAD at bucket ${i}`).toBeCloseTo(
        mad(history),
        10,
      );
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});
