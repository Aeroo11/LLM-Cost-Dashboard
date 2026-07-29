import { Scale } from "lucide-react";
import { avgQuality, type Summary } from "@/lib/aggregate";
import type { Endpoint } from "@/lib/types";
import { formatInt, formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card } from "./ui/card";

/**
 * Is each endpoint's spend proportionate to its traffic?
 *
 * "Cost by endpoint" answers where the money goes, but it plots *totals*, which
 * volume dominates — a low-traffic endpoint burning 4x the fleet rate hides
 * inside a short bar. Normalising by request count is what makes that endpoint
 * pop, and the question "above or below a baseline" is exactly what a diverging
 * bar is for.
 *
 * Built as a real <table> in plain HTML rather than Recharts: no bundle cost,
 * no ResponsiveContainer, and because every value is in a cell it doubles as
 * the table-view twin that a chart should always have.
 *
 * The baseline is Summary.avgCostPerRequest — the same figure the KPI tile
 * above shows, so the two can never disagree.
 */
export function EndpointEconomics({ summary }: { summary: Summary }) {
  const baseline = summary.avgCostPerRequest;

  const rows = (Object.keys(summary.byEndpoint) as Endpoint[])
    .map((endpoint) => {
      const g = summary.byEndpoint[endpoint];
      const perRequest = g.requests > 0 ? g.costUsd / g.requests : 0;
      return {
        endpoint,
        requests: g.requests,
        costUsd: g.costUsd,
        perRequest,
        // Signed distance from the fleet average, as a share of it.
        deviation: baseline > 0 ? (perRequest - baseline) / baseline : 0,
        coverage: g.inputTokens > 0 ? g.cachedTokens / g.inputTokens : 0,
        quality: avgQuality(g),
      };
    })
    .filter((r) => r.requests > 0)
    .sort((a, b) => b.perRequest - a.perRequest);

  // A shared scale, so bar length is comparable between rows. Capped at ±100%
  // so one extreme endpoint cannot flatten the rest into invisibility.
  const reach = Math.min(
    1,
    Math.max(0.25, ...rows.map((r) => Math.abs(r.deviation))),
  );

  return (
    <Card>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Scale
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-text-subtle"
          />
          Endpoint economics
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Cost per request vs the fleet average of {formatUsd(baseline)} · right of
          centre is above it
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="px-2 py-2 text-eyebrow uppercase font-medium text-text-muted">
                Endpoint
              </th>
              <th scope="col" className="px-2 py-2 text-right text-eyebrow uppercase font-medium text-text-muted">
                Cost / req
              </th>
              <th scope="col" className="w-2/5 px-2 py-2 text-eyebrow uppercase font-medium text-text-muted">
                vs fleet average
              </th>
              <th scope="col" className="px-2 py-2 text-right text-eyebrow uppercase font-medium text-text-muted">
                Cached
              </th>
              <th scope="col" className="px-2 py-2 text-right text-eyebrow uppercase font-medium text-text-muted">
                Quality
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const over = r.deviation >= 0;
              const frac = Math.min(1, Math.abs(r.deviation) / reach);
              // Bars reach 38% of the cell rather than the full 50%, which
              // reserves a gutter wide enough for the label at every length.
              // Labelling inside was the alternative, but an 8px bar is too
              // thin to hold 11px text legibly.
              const width = `${frac * 38}%`;
              return (
                <tr key={r.endpoint} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-2 py-2.5">
                    <span className="font-medium">{r.endpoint}</span>
                    <span className="ml-2 text-xs text-text-subtle tabular-nums">
                      {formatInt(r.requests)} req
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                    {formatUsd(r.perRequest)}
                  </td>
                  <td className="px-2 py-2.5">
                    {/* Centre line is the fleet average; bars grow away from it. */}
                    <div className="relative h-4">
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-strong"
                      />
                      <span
                        className={cn(
                          "absolute top-1/2 h-2 -translate-y-1/2",
                          over ? "left-1/2 rounded-r-sm" : "right-1/2 rounded-l-sm",
                        )}
                        style={{
                          width,
                          backgroundColor: over
                            ? "var(--div-over)"
                            : "var(--div-under)",
                        }}
                      />
                      <span
                        className={cn(
                          "absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-eyebrow tabular-nums",
                          over ? "text-div-over" : "text-div-under",
                        )}
                        style={
                          over
                            ? { left: `calc(50% + ${width} + 6px)` }
                            : { right: `calc(50% + ${width} + 6px)` }
                        }
                      >
                        {over ? "+" : "−"}
                        {formatPercent(Math.abs(r.deviation), 0)}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-text-muted">
                    {formatPercent(r.coverage, 0)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-text-muted">
                    {r.quality != null ? r.quality.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
