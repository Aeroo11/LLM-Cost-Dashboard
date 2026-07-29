import { NextResponse, type NextRequest } from "next/server";
import { generateRequests } from "@/lib/generator";
import { summarize } from "@/lib/aggregate";
import { computeInsights, totalMonthlySavings } from "@/lib/insights";
import { WINDOWS, type MetricsResponse, type WindowKey } from "@/lib/api-types";

// Always compute fresh — the window slides with wall-clock time.
export const dynamic = "force-dynamic";

const SEED = 42;
const RATE_PER_MIN = 8;

function pct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export function GET(req: NextRequest): NextResponse<MetricsResponse> {
  const raw = req.nextUrl.searchParams.get("window");
  const windowKey: WindowKey = raw === "7d" ? "7d" : "24h";
  const { hours, bucketMinutes } = WINDOWS[windowKey];

  // Edge of the pure core: anchor to wall-clock, bucketed to the minute so
  // repeated polls within a minute return identical, stable numbers.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const windowMs = hours * 3600_000;

  // Seed per window index so each period is a *distinct* stream. Without this,
  // the diurnal pattern is 24h-periodic and current/previous windows would be
  // statistically identical (delta always ~0).
  const seedFor = (anchor: number) => SEED + Math.floor(anchor / windowMs);

  const current = generateRequests({ now, windowHours: hours, ratePerMin: RATE_PER_MIN, seed: seedFor(now) });
  const summary = summarize(current, now, hours, bucketMinutes);

  // Immediately preceding window of the same length, for delta comparison.
  const prevNow = now - windowMs;
  const previous = generateRequests({ now: prevNow, windowHours: hours, ratePerMin: RATE_PER_MIN, seed: seedFor(prevNow) });
  const prevSummary = summarize(previous, prevNow, hours, bucketMinutes);

  const insights = computeInsights(current, summary);

  return NextResponse.json({
    generatedAt: now,
    windowKey,
    windowHours: hours,
    summary,
    deltas: {
      totalCostPct: pct(summary.totalCostUsd, prevSummary.totalCostUsd),
      requestsPct: pct(summary.totalRequests, prevSummary.totalRequests),
      avgCostPct: pct(summary.avgCostPerRequest, prevSummary.avgCostPerRequest),
      errorRatePct: pct(summary.errorRate, prevSummary.errorRate),
    },
    insights,
    potentialMonthlySavingsUsd: totalMonthlySavings(insights),
  });
}
