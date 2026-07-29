"use client";

import type { Anomaly, AnomalyMetric } from "@/lib/db/anomalies";
import { DEFAULT_THRESHOLD } from "@/lib/anomaly";
import { SEVERITY_COLOR } from "@/lib/palette";
import { Card } from "./ui/card";

const METRIC_LABEL: Record<AnomalyMetric, string> = {
  cost: "Cost",
  error_rate: "Errors",
  latency_p95: "Latency",
};

function timeOf(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlertsPanel({
  anomalies,
  onSelect,
}: {
  anomalies: Anomaly[];
  /** Called with the bucket timestamp so the charts can highlight it. */
  onSelect?: (at: number) => void;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span aria-hidden>🚨</span> Anomalies
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Modified z-score vs a rolling median baseline, flagged past{" "}
            {DEFAULT_THRESHOLD}σ
          </p>
        </div>
        {anomalies.length > 0 && (
          <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger tabular-nums">
            {anomalies.length}
          </span>
        )}
      </div>

      {anomalies.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          Nothing unusual in this window. ✓
        </p>
      ) : (
        <ul className="space-y-2">
          {anomalies.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect?.(a.at)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-text-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLOR[a.severity] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">
                      {METRIC_LABEL[a.metric]} {a.direction}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      {timeOf(a.at)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                    {a.detail}
                  </span>
                </span>
                <span
                  className="shrink-0 font-mono text-xs tabular-nums"
                  style={{ color: SEVERITY_COLOR[a.severity] }}
                >
                  {a.score > 0 ? "+" : ""}
                  {a.score.toFixed(1)}σ
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
