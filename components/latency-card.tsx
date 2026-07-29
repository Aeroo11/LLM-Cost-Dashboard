import { Timer } from "lucide-react";
import type { Summary } from "@/lib/aggregate";
import { formatMs } from "@/lib/format";
import { Card } from "./ui/card";

/**
 * Latency as a quantile strip.
 *
 * Three known percentiles is not a time series, so this plots exactly those
 * three points on a 0 → p99 track and interpolates nothing. The p50→p95 span is
 * where the mass of requests sits; p95→p99 is the tail. p95 carries the visual
 * weight because it is the number an SLO is written against.
 *
 * A latency-over-time chart would be the better view, but it is not reachable
 * from the frontend: TimeBucket (lib/aggregate.ts) carries cost and request
 * count per bucket, no latency. It needs latencyP95 added to the bucket and a
 * quantile_cont in the time-series GROUP BY.
 */
export function LatencyCard({ summary }: { summary: Summary }) {
  const { latencyP50: p50, latencyP95: p95, latencyP99: p99 } = summary;
  const span = p99 || 1;
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / span) * 100))}%`;

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Timer
          size={16}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-text-subtle"
        />
        Latency
      </h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Response time distribution across the window
      </p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-stat font-semibold">{formatMs(p95)}</span>
        <span className="text-xs text-text-muted">p95</span>
      </p>

      <div className="relative mt-4 h-2.5 w-full rounded-full bg-surface-2">
        {/* Where the mass of requests sits. */}
        <div
          className="absolute inset-y-0 rounded-full bg-accent/30"
          style={{ left: at(p50), right: `calc(100% - ${at(p95)})` }}
        />
        {/* The tail. */}
        <div
          className="absolute inset-y-0 rounded-full bg-warning/30"
          style={{ left: at(p95), right: 0 }}
        />
        {[
          { v: p50, color: "bg-accent" },
          { v: p95, color: "bg-accent" },
          { v: p99, color: "bg-warning" },
        ].map(({ v, color }) => (
          <span
            key={v}
            aria-hidden
            className={`absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${color}`}
            style={{ left: at(v) }}
          />
        ))}
      </div>

      {/* No `uppercase` here, unlike the other eyebrow labels: a percentile is
          conventionally written with a lowercase p. */}
      <dl className="mt-3 flex justify-between text-eyebrow text-text-muted">
        {[
          ["p50", p50],
          ["p95", p95],
          ["p99", p99],
        ].map(([label, v]) => (
          <div key={label as string} className="flex flex-col gap-0.5">
            <dt>{label}</dt>
            <dd className="text-xs tabular-nums text-text">
              {formatMs(v as number)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
