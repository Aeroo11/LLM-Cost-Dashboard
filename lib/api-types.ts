import type { Summary } from "./aggregate";
import type { Insight, SavingsBreakdown } from "./insights";
import type { MetricFilters } from "./db/filters";
import type { Anomaly } from "./db/anomalies";
import type { EndpointModelCell } from "./db/queries";

/** Selectable observation windows. */
export type WindowKey = "1h" | "24h" | "7d";

export const WINDOWS: Record<
  WindowKey,
  { hours: number; label: string; bucketMinutes: number }
> = {
  "1h": { hours: 1, label: "1h", bucketMinutes: 2 },
  "24h": { hours: 24, label: "24h", bucketMinutes: 30 },
  "7d": { hours: 168, label: "7d", bucketMinutes: 180 },
};

export const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[];

export function parseWindowKey(raw: string | null): WindowKey {
  return WINDOW_KEYS.includes(raw as WindowKey) ? (raw as WindowKey) : "24h";
}

/** Payload returned by GET /api/metrics and pushed over /api/stream. */
export interface MetricsResponse {
  generatedAt: number;
  /** Epoch ms up to which events have been ingested — the stream's "as of". */
  ingestHeadMs: number;
  windowKey: WindowKey;
  windowHours: number;
  /** Window bounds actually queried, so the client need not recompute them. */
  range: { fromMs: number; toMs: number };
  /** Echo of the filters the server applied, after validation. */
  filters: MetricFilters;
  summary: Summary;
  /** Percent change vs the immediately preceding window of the same length. */
  deltas: {
    totalCostPct: number;
    requestsPct: number;
    avgCostPct: number;
    errorRatePct: number;
  };
  insights: Insight[];
  /** Recoverable monthly spend, split by measured vs assumption-based. */
  savings: SavingsBreakdown;
  /** Statistical outliers in the bucketed series, most recent first. */
  anomalies: Anomaly[];
  /** Cost cross-tabbed by endpoint and model — where routing leaks show up. */
  endpointMatrix: EndpointModelCell[];
}
