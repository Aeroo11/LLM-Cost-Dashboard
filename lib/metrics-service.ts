import "server-only";

import { withConnection } from "./db/client";
import { queryEndpointMatrix, querySummary, queryTotals } from "./db/queries";
import { queryInsights } from "./db/insights";
import { queryAnomalies } from "./db/anomalies";
import { totalMonthlySavings } from "./insights";
import type { MetricFilters, TimeRange } from "./db/filters";
import { MINUTE_MS } from "./generator";
import { WINDOWS, type MetricsResponse, type WindowKey } from "./api-types";

/**
 * Assembles the dashboard payload.
 *
 * Extracted from the route handler because two transports need it: the plain
 * `GET /api/metrics` request and the SSE stream, which re-runs it on every tick.
 */

function pct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * The trailing window as of `nowMs`.
 *
 * The upper bound is the live clock, so events ingested a second ago are
 * included. The lower bound is snapped *down* to the bucket grid: if it slid
 * continuously, every tick would re-cut the series at a different offset and
 * the chart would shimmer as bars jumped between buckets. Snapping fixes bucket
 * edges in absolute time, so the window slides one whole bucket at a time while
 * the newest bucket fills up in real time — which is what a live chart should
 * look like.
 *
 * The window is therefore up to one bucket longer than nominal. Everything
 * downstream derives its span from the actual bounds rather than assuming the
 * nominal length, so rates and projections stay correct.
 */
export function currentRange(windowKey: WindowKey, nowMs = Date.now()): TimeRange {
  const { hours, bucketMinutes } = WINDOWS[windowKey];
  const bucketMs = bucketMinutes * MINUTE_MS;
  const fromMs = Math.floor((nowMs - hours * 3600_000) / bucketMs) * bucketMs;
  return { fromMs, toMs: nowMs };
}

/**
 * Cheap identity for a payload: changes exactly when the underlying data does.
 * The stream uses it to avoid pushing frames that would be byte-identical.
 */
export function metricsFingerprint(payload: MetricsResponse): string {
  const s = payload.summary;
  return [
    s.totalRequests,
    s.totalCostUsd.toFixed(9),
    s.timeSeries.length,
    payload.anomalies.length,
    payload.comparisonAvailable,
    ...Object.values(payload.deltas),
  ].join(":");
}

export async function buildMetrics(
  windowKey: WindowKey,
  filters: MetricFilters,
  nowMs = Date.now(),
): Promise<MetricsResponse> {
  const { bucketMinutes, hours } = WINDOWS[windowKey];
  const range = currentRange(windowKey, nowMs);
  const previous: TimeRange = {
    fromMs: range.fromMs - (range.toMs - range.fromMs),
    toMs: range.fromMs,
  };

  // One borrowed connection for the whole payload: every query below reads the
  // same snapshot, so the KPI row can never disagree with the chart beneath it.
  const { summary, prev, insights, anomalies, endpointMatrix, ingestHeadMs } =
    await withConnection(async (connection, coverage) => {
      const comparisonAvailable = previous.fromMs >= coverage.fromMs
        && previous.toMs <= coverage.toMs;
      const [summary, prev, anomalies, endpointMatrix] = await Promise.all([
        querySummary(connection, range, filters, bucketMinutes),
        comparisonAvailable ? queryTotals(connection, previous, filters) : null,
        queryAnomalies(connection, range, filters, bucketMinutes),
        queryEndpointMatrix(connection, range, filters),
      ]);
      // Depends on the burn rate, so it cannot join the batch above.
      const insights = await queryInsights(
        connection,
        range,
        filters,
        summary.burnRateMonthlyUsd,
      );
      return { summary, prev, insights, anomalies, endpointMatrix, ingestHeadMs: coverage.toMs };
    });

  return {
    generatedAt: range.toMs,
    ingestHeadMs,
    windowKey,
    windowHours: hours,
    range,
    filters,
    summary,
    comparisonAvailable: prev !== null,
    deltas: {
      totalCostPct: prev ? pct(summary.totalCostUsd, prev.totalCostUsd) : null,
      requestsPct: prev ? pct(summary.totalRequests, prev.totalRequests) : null,
      avgCostPct: prev?.totalRequests && summary.totalRequests
        ? pct(summary.avgCostPerRequest, prev.avgCostPerRequest) : null,
      errorRatePct: prev?.totalRequests && summary.totalRequests
        ? pct(summary.errorRate, prev.errorRate) : null,
    },
    insights,
    savings: totalMonthlySavings(insights),
    anomalies,
    endpointMatrix,
  };
}
