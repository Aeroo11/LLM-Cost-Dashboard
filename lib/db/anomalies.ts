import "server-only";

import type { DuckDBConnection } from "@duckdb/node-api";
import { DEFAULT_THRESHOLD, MIN_HISTORY } from "../anomaly";
import { buildPredicate, type MetricFilters, type TimeRange } from "./filters";
import { formatMs, formatPercent, formatUsd } from "../format";

/**
 * Anomaly detection over the bucketed time series.
 *
 * Implements the same modified z-score as `lib/anomaly.ts`, but in SQL so the
 * whole sweep is one pass over the fact table instead of shipping every bucket
 * to JavaScript. The two are reconciled in the tests.
 *
 * The awkward-looking `list_aggregate(...)` construction is doing real work:
 * window functions cannot be nested, so `median(abs(x - median(x) OVER w)) OVER w`
 * is not expressible. Collecting the trailing window into a list with
 * `array_agg() OVER w` and reducing it with list lambdas computes MAD exactly,
 * rather than the common approximation of deviating from a per-row median.
 */

export type AnomalyMetric = "cost" | "error_rate" | "latency_p95";
export type AnomalyDirection = "spike" | "drop";

export interface Anomaly {
  id: string;
  metric: AnomalyMetric;
  direction: AnomalyDirection;
  severity: "high" | "medium" | "low";
  /** Bucket start, epoch ms. */
  at: number;
  /** Observed value in the bucket. */
  value: number;
  /** Rolling median of the preceding buckets — what was expected. */
  baseline: number;
  /** Signed modified z-score. */
  score: number;
  title: string;
  detail: string;
}

function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return 0;
}

/**
 * How far back the baseline looks, in buckets. Long enough to cover a full
 * diurnal cycle at the 24h/30-minute resolution, so the ordinary evening
 * ramp-down is part of the baseline rather than a finding.
 */
const LOOKBACK_BUCKETS = 48;

function severityFor(score: number): Anomaly["severity"] {
  const z = Math.abs(score);
  if (z >= 3 * DEFAULT_THRESHOLD) return "high";
  if (z >= 1.7 * DEFAULT_THRESHOLD) return "medium";
  return "low";
}

/**
 * Per-metric presentation and policy.
 *
 * `drops` marks metrics where a fall is also worth reporting. A cost or traffic
 * collapse usually means an outage upstream; a *drop* in error rate or latency
 * is good news and reporting it would be noise.
 */
const METRICS: Record<
  AnomalyMetric,
  { label: string; drops: boolean; format: (v: number) => string }
> = {
  cost: { label: "Cost", drops: true, format: formatUsd },
  error_rate: { label: "Error rate", drops: false, format: formatPercent },
  latency_p95: { label: "p95 latency", drops: false, format: formatMs },
};

/**
 * Lower bounds on the spread estimate, per metric.
 *
 * MAD goes to zero whenever more than half the trailing window shares a value,
 * and a healthy service sits at *exactly* zero errors for hours — so without a
 * floor, the error rate could never raise an alert no matter how far it jumped.
 * The floors double as a practical-significance gate: they stop a metric that
 * normally varies by a rounding error from reporting a finding because it
 * varied by two rounding errors.
 *
 * Cost is scaled to its own baseline because absolute spend depends entirely on
 * traffic volume; the other two are absolute because a percentage point and a
 * millisecond mean the same thing at any scale.
 */
const NOISE_FLOOR = {
  /** 5% of the rolling baseline. */
  costRelative: 0.05,
  /** Half a percentage point of error rate. */
  errorRate: 0.005,
  /** 25 ms of p95 latency. */
  latencyMs: 25,
} as const;

export async function queryAnomalies(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  bucketMinutes: number,
): Promise<Anomaly[]> {
  const p = buildPredicate(range, filters);
  const bucketParam = `$${p.params.length + 1}`;
  const originParam = `$${p.params.length + 2}`;

  const reader = await connection.runAndReadAll(
    /* sql */ `
      WITH buckets AS (
        SELECT
          CAST(epoch_ms(time_bucket(
            to_minutes(${bucketParam}::BIGINT), ts, epoch_ms(${originParam}::BIGINT)
          )) AS BIGINT)                                            AS bucket_ms,
          sum(cost_usd)                                            AS cost_usd,
          count(*)                                                 AS requests,
          count(*) FILTER (WHERE NOT is_success)::DOUBLE
            / nullif(count(*), 0)                                  AS error_rate,
          quantile_cont(latency_ms, 0.95)                          AS p95_ms
        FROM v_requests
        WHERE ${p.sql}
        GROUP BY 1
      ),
      history AS (
        SELECT
          *,
          -- The trailing window, current bucket excluded: including a point in
          -- its own baseline blunts exactly the signal we are looking for.
          array_agg(cost_usd)   OVER w AS cost_hist,
          array_agg(error_rate) OVER w AS err_hist,
          array_agg(p95_ms)     OVER w AS lat_hist
        FROM buckets
        WINDOW w AS (
          ORDER BY bucket_ms
          ROWS BETWEEN ${LOOKBACK_BUCKETS} PRECEDING AND 1 PRECEDING
        )
      ),
      scored AS (
        SELECT
          bucket_ms,
          requests,
          cost_usd, error_rate, p95_ms,
          len(cost_hist)                                    AS history_len,
          list_aggregate(cost_hist, 'median')               AS cost_med,
          list_aggregate(err_hist,  'median')               AS err_med,
          list_aggregate(lat_hist,  'median')               AS lat_med,
          list_aggregate(list_transform(cost_hist,
            x -> abs(x - list_aggregate(cost_hist, 'median'))), 'median') AS cost_mad,
          list_aggregate(list_transform(err_hist,
            x -> abs(x - list_aggregate(err_hist,  'median'))), 'median') AS err_mad,
          list_aggregate(list_transform(lat_hist,
            x -> abs(x - list_aggregate(lat_hist,  'median'))), 'median') AS lat_mad
        FROM history
      )
      SELECT
        bucket_ms, requests,
        cost_usd, error_rate, p95_ms,
        cost_med, err_med, lat_med,
        -- 0.6745 is the modified z-score constant. Each spread estimate is
        -- floored (see NOISE_FLOOR) so a flat history cannot silence the
        -- detector; nullif still guards the genuinely empty case.
        0.6745 * (cost_usd   - cost_med)
          / nullif(greatest(cost_mad, ${NOISE_FLOOR.costRelative} * cost_med), 0) AS cost_z,
        0.6745 * (error_rate - err_med)
          / nullif(greatest(err_mad,  ${NOISE_FLOOR.errorRate}), 0)               AS err_z,
        0.6745 * (p95_ms     - lat_med)
          / nullif(greatest(lat_mad,  ${NOISE_FLOOR.latencyMs}), 0)               AS lat_z
      FROM scored
      WHERE history_len >= ${MIN_HISTORY}
      ORDER BY bucket_ms
    `,
    [...p.params, bucketMinutes, range.fromMs],
  );

  const anomalies: Anomaly[] = [];

  for (const row of reader.getRowObjects()) {
    const at = num(row.bucket_ms);

    const candidates: Array<[AnomalyMetric, unknown, number, number]> = [
      ["cost", row.cost_z, num(row.cost_usd), num(row.cost_med)],
      ["error_rate", row.err_z, num(row.error_rate), num(row.err_med)],
      ["latency_p95", row.lat_z, num(row.p95_ms), num(row.lat_med)],
    ];

    for (const [metric, rawZ, value, baseline] of candidates) {
      // NULL z means "not enough signal to judge", which is not a finding.
      if (rawZ === null || rawZ === undefined) continue;
      const score = num(rawZ);
      if (!Number.isFinite(score) || Math.abs(score) < DEFAULT_THRESHOLD) continue;

      const direction: AnomalyDirection = score > 0 ? "spike" : "drop";
      const spec = METRICS[metric];
      if (direction === "drop" && !spec.drops) continue;

      const multiple = baseline > 0 ? value / baseline : 0;
      anomalies.push({
        id: `${metric}-${at}`,
        metric,
        direction,
        severity: severityFor(score),
        at,
        value,
        baseline,
        score,
        title: `${spec.label} ${direction === "spike" ? "spike" : "drop"}`,
        detail:
          `${spec.format(value)} against a rolling baseline of ${spec.format(baseline)}` +
          (multiple > 0 ? ` (${multiple.toFixed(1)}×)` : "") +
          `, ${Math.abs(score).toFixed(1)}σ from normal.`,
      });
    }
  }

  // Most recent first: an operator cares about what is happening now, and the
  // list is capped so one bad hour cannot flood the panel.
  return anomalies.sort((a, b) => b.at - a.at).slice(0, 12);
}
