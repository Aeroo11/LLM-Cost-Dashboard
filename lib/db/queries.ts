import "server-only";

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Endpoint, LLMRequest, ModelId, RequestStatus } from "../types";
import { MODEL_IDS } from "../models";
import type { GroupStats, Summary, TimeBucket } from "../aggregate";
import {
  buildPredicate,
  ENDPOINT_IDS,
  type MetricFilters,
  type SqlParam,
  type TimeRange,
} from "./filters";

/**
 * Analytical layer. Every number the dashboard shows is produced by one of the
 * queries below — the TypeScript roll-up in `lib/aggregate.ts` is retained only
 * as an independent reference implementation that the test suite reconciles
 * these results against.
 */

/** DuckDB returns BIGINT/HUGEINT as JS BigInt; normalise to number at the edge. */
function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return 0;
}

type Row = Record<string, unknown>;

async function all(
  connection: DuckDBConnection,
  sql: string,
  params: SqlParam[],
): Promise<Row[]> {
  const reader = await connection.runAndReadAll(sql, params);
  return reader.getRowObjects() as Row[];
}

function emptyGroup(): GroupStats {
  return {
    requests: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    qualitySum: 0,
    qualityCount: 0,
  };
}

function rowToGroup(r: Row): GroupStats {
  return {
    requests: num(r.requests),
    costUsd: num(r.cost_usd),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cachedTokens: num(r.cached_tokens),
    qualitySum: num(r.quality_sum),
    qualityCount: num(r.quality_count),
  };
}

/** The aggregate expressions shared by the headline and per-dimension queries. */
const GROUP_COLUMNS = /* sql */ `
  count(*)                                                     AS requests,
  coalesce(sum(cost_usd), 0)                                   AS cost_usd,
  coalesce(sum(input_tokens), 0)                               AS input_tokens,
  coalesce(sum(output_tokens), 0)                              AS output_tokens,
  coalesce(sum(cached_tokens), 0)                              AS cached_tokens,
  coalesce(sum(quality_score) FILTER (WHERE is_success), 0)    AS quality_sum,
  count(*) FILTER (WHERE is_success)                           AS quality_count
`;

async function queryHeadline(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
) {
  const p = buildPredicate(range, filters);
  const rows = await all(
    connection,
    /* sql */ `
      SELECT
        ${GROUP_COLUMNS},
        count(*) FILTER (WHERE NOT is_success)        AS failures,
        coalesce(quantile_cont(latency_ms, 0.50), 0)  AS p50,
        coalesce(quantile_cont(latency_ms, 0.95), 0)  AS p95,
        coalesce(quantile_cont(latency_ms, 0.99), 0)  AS p99
      FROM v_requests
      WHERE ${p.sql}
    `,
    p.params,
  );
  const r = rows[0] ?? {};
  return {
    group: rowToGroup(r),
    failures: num(r.failures),
    p50: num(r.p50),
    p95: num(r.p95),
    p99: num(r.p99),
  };
}

/**
 * Group by a dimension column. `column` is a compile-time union, never a
 * caller-supplied string, so interpolating it is safe.
 */
async function queryByDimension<K extends string>(
  connection: DuckDBConnection,
  column: "model" | "endpoint",
  keys: readonly K[],
  range: TimeRange,
  filters: MetricFilters,
): Promise<Record<K, GroupStats>> {
  const p = buildPredicate(range, filters);
  const rows = await all(
    connection,
    /* sql */ `
      SELECT ${column} AS key, ${GROUP_COLUMNS}
      FROM v_requests
      WHERE ${p.sql}
      GROUP BY 1
    `,
    p.params,
  );

  // Start from a zero-filled record so a model with no traffic in the window
  // still appears (as zero) rather than vanishing from the chart.
  const out = Object.fromEntries(keys.map((k) => [k, emptyGroup()])) as Record<
    K,
    GroupStats
  >;
  for (const r of rows) {
    const key = String(r.key) as K;
    if (key in out) out[key] = rowToGroup(r);
  }
  return out;
}

/**
 * Cost per time bucket, split by model.
 *
 * `time_bucket` is given an explicit origin (the window start) so bucket edges
 * line up with the window rather than with the Unix epoch — without it, a 3-hour
 * bucket over a 7-day window would straddle the boundary and the first and last
 * buckets would silently under-count.
 */
async function queryTimeSeries(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  bucketMinutes: number,
): Promise<TimeBucket[]> {
  const p = buildPredicate(range, filters);
  const bucketParam = `$${p.params.length + 1}`;
  const originParam = `$${p.params.length + 2}`;

  const rows = await all(
    connection,
    /* sql */ `
      SELECT
        CAST(epoch_ms(time_bucket(
          to_minutes(${bucketParam}::BIGINT),
          ts,
          epoch_ms(${originParam}::BIGINT)
        )) AS BIGINT)          AS bucket_ms,
        model                  AS model,
        coalesce(sum(cost_usd), 0) AS cost_usd,
        count(*)               AS requests
      FROM v_requests
      WHERE ${p.sql}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    [...p.params, bucketMinutes, range.fromMs],
  );

  // Materialise a complete spine so gaps render as zero instead of collapsing
  // the x-axis. Empty buckets are a real signal (an outage looks like a gap).
  const bucketMs = bucketMinutes * 60_000;
  const count = Math.ceil((range.toMs - range.fromMs) / bucketMs);
  const spine: TimeBucket[] = Array.from({ length: count }, (_, i) => ({
    t: range.fromMs + i * bucketMs,
    costUsd: 0,
    requests: 0,
    costByModel: Object.fromEntries(MODEL_IDS.map((m) => [m, 0])) as Record<
      ModelId,
      number
    >,
  }));

  for (const r of rows) {
    const idx = Math.floor((num(r.bucket_ms) - range.fromMs) / bucketMs);
    if (idx < 0 || idx >= spine.length) continue;
    const cost = num(r.cost_usd);
    const model = String(r.model) as ModelId;
    spine[idx].costUsd += cost;
    spine[idx].requests += num(r.requests);
    if (model in spine[idx].costByModel) spine[idx].costByModel[model] += cost;
  }
  return spine;
}

export interface EndpointModelCell {
  endpoint: Endpoint;
  model: ModelId;
  costUsd: number;
  requests: number;
}

/**
 * Cost broken down by endpoint *and* model.
 *
 * The single most diagnostic view in the dashboard, and the one the original
 * version computed and then never rendered: it is where over-provisioned
 * routing becomes visible — a cheap, high-volume workload with an expensive
 * model taking a large slice of its bar.
 */
export async function queryEndpointMatrix(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
): Promise<EndpointModelCell[]> {
  const p = buildPredicate(range, filters);
  const rows = await all(
    connection,
    /* sql */ `
      SELECT endpoint, model,
             coalesce(sum(cost_usd), 0) AS cost_usd,
             count(*)                   AS requests
      FROM v_requests
      WHERE ${p.sql}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    p.params,
  );

  return rows.map((r) => ({
    endpoint: String(r.endpoint) as Endpoint,
    model: String(r.model) as ModelId,
    costUsd: num(r.cost_usd),
    requests: num(r.requests),
  }));
}

export interface WindowTotals {
  totalCostUsd: number;
  totalRequests: number;
  avgCostPerRequest: number;
  errorRate: number;
}

/**
 * Just the headline numbers. Used for the previous-window comparison, where
 * building a full time-series spine would be wasted work.
 */
export async function queryTotals(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
): Promise<WindowTotals> {
  const h = await queryHeadline(connection, range, filters);
  const requests = h.group.requests;
  return {
    totalCostUsd: h.group.costUsd,
    totalRequests: requests,
    avgCostPerRequest: requests > 0 ? h.group.costUsd / requests : 0,
    errorRate: requests > 0 ? h.failures / requests : 0,
  };
}

/** Full window roll-up: the SQL counterpart of `summarize()`. */
export async function querySummary(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  bucketMinutes: number,
): Promise<Summary> {
  const [headline, byModel, byEndpoint, timeSeries] = await Promise.all([
    queryHeadline(connection, range, filters),
    queryByDimension(connection, "model", MODEL_IDS, range, filters),
    queryByDimension(connection, "endpoint", ENDPOINT_IDS, range, filters),
    queryTimeSeries(connection, range, filters, bucketMinutes),
  ]);

  const g = headline.group;
  const windowHours = (range.toMs - range.fromMs) / 3600_000;
  const observedDays = windowHours / 24;

  return {
    totalCostUsd: g.costUsd,
    totalRequests: g.requests,
    avgCostPerRequest: g.requests > 0 ? g.costUsd / g.requests : 0,
    totalInputTokens: g.inputTokens,
    totalOutputTokens: g.outputTokens,
    totalCachedTokens: g.cachedTokens,
    errorRate: g.requests > 0 ? headline.failures / g.requests : 0,
    latencyP50: headline.p50,
    latencyP95: headline.p95,
    latencyP99: headline.p99,
    burnRateMonthlyUsd: observedDays > 0 ? (g.costUsd / observedDays) * 30 : 0,
    byModel,
    byEndpoint,
    timeSeries,
    windowHours,
  };
}

export type RequestSortKey = "ts" | "cost_usd" | "latency_ms" | "input_tokens";
const SORT_COLUMNS: Record<RequestSortKey, string> = {
  ts: "ts",
  cost_usd: "cost_usd",
  latency_ms: "latency_ms",
  input_tokens: "input_tokens",
};

export interface RequestPage {
  rows: LLMRequest[];
  /** Total matching rows, for the pager. */
  total: number;
}

/**
 * Paged raw events for the drill-down table. Sort key and direction are mapped
 * through closed unions rather than interpolated from the request.
 */
export async function queryRequests(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  opts: {
    sort?: RequestSortKey;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
  } = {},
): Promise<RequestPage> {
  const sort = SORT_COLUMNS[opts.sort ?? "ts"];
  const direction = opts.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const p = buildPredicate(range, filters);
  const [countRows, rows] = await Promise.all([
    all(connection, `SELECT count(*) AS n FROM v_requests WHERE ${p.sql}`, p.params),
    all(
      connection,
      /* sql */ `
        SELECT
          id, ts_ms, model, endpoint, input_tokens, output_tokens,
          cached_tokens, latency_ms, status, quality_score, cost_usd
        FROM v_requests
        WHERE ${p.sql}
        ORDER BY ${sort} ${direction}, id
        LIMIT $${p.params.length + 1} OFFSET $${p.params.length + 2}
      `,
      [...p.params, limit, offset],
    ),
  ]);

  return {
    total: num(countRows[0]?.n),
    rows: rows.map((r) => ({
      id: String(r.id),
      timestamp: num(r.ts_ms),
      model: String(r.model) as ModelId,
      endpoint: String(r.endpoint) as Endpoint,
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cachedTokens: num(r.cached_tokens),
      latencyMs: num(r.latency_ms),
      status: String(r.status) as RequestStatus,
      qualityScore: num(r.quality_score),
      costUsd: num(r.cost_usd),
    })),
  };
}
