import type { Summary } from "./aggregate";
import type { Insight } from "./insights";

/** Selectable observation windows. */
export type WindowKey = "24h" | "7d";

export const WINDOWS: Record<WindowKey, { hours: number; label: string; bucketMinutes: number }> = {
  "24h": { hours: 24, label: "24h", bucketMinutes: 30 },
  "7d": { hours: 168, label: "7d", bucketMinutes: 180 },
};

/** Payload returned by GET /api/metrics. Shared by the route and the client. */
export interface MetricsResponse {
  generatedAt: number;
  windowKey: WindowKey;
  windowHours: number;
  summary: Summary;
  /** Percent change vs the immediately preceding window of the same length. */
  deltas: {
    totalCostPct: number;
    requestsPct: number;
    avgCostPct: number;
    errorRatePct: number;
  };
  insights: Insight[];
  /** Total recoverable monthly spend across all insights. */
  potentialMonthlySavingsUsd: number;
}
