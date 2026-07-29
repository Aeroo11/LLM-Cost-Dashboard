import "server-only";

import { withConnection } from "./db/client";
import { querySummary, queryTotals } from "./db/queries";
import { queryInsights } from "./db/insights";
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

function pct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Anchor the window to a whole minute. The store ingests in minute-sized
 * batches, so aligning to the same boundary keeps a query and the data it reads
 * consistent — and makes repeated calls within a minute return identical bytes.
 */
export function currentRange(windowKey: WindowKey, nowMs = Date.now()): TimeRange {
  const toMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  return { fromMs: toMs - WINDOWS[windowKey].hours * 3600_000, toMs };
}

export async function buildMetrics(
  windowKey: WindowKey,
  filters: MetricFilters,
  nowMs = Date.now(),
): Promise<MetricsResponse> {
  const { bucketMinutes, hours } = WINDOWS[windowKey];
  const range = currentRange(windowKey, nowMs);
  const windowMs = hours * 3600_000;
  const previous: TimeRange = {
    fromMs: range.fromMs - windowMs,
    toMs: range.toMs - windowMs,
  };

  // One borrowed connection for the whole payload: every query below reads the
  // same snapshot, so the KPI row can never disagree with the chart beneath it.
  const { summary, prev, insights } = await withConnection(async (connection) => {
    const [summary, prev] = await Promise.all([
      querySummary(connection, range, filters, bucketMinutes),
      queryTotals(connection, previous, filters),
    ]);
    const insights = await queryInsights(
      connection,
      range,
      filters,
      summary.burnRateMonthlyUsd,
    );
    return { summary, prev, insights };
  });

  return {
    generatedAt: range.toMs,
    windowKey,
    windowHours: hours,
    range,
    filters,
    summary,
    deltas: {
      totalCostPct: pct(summary.totalCostUsd, prev.totalCostUsd),
      requestsPct: pct(summary.totalRequests, prev.totalRequests),
      avgCostPct: pct(summary.avgCostPerRequest, prev.avgCostPerRequest),
      errorRatePct: pct(summary.errorRate, prev.errorRate),
    },
    insights,
    savings: totalMonthlySavings(insights),
  };
}
