import type { Insight, InsightSeverity } from "@/lib/insights";
import { formatUsd } from "@/lib/format";

const SEVERITY: Record<
  InsightSeverity,
  { label: string; icon: string; color: string; bar: string }
> = {
  high: { label: "High impact", icon: "▲", color: "#ec835a", bar: "#ec835a" },
  medium: { label: "Medium", icon: "●", color: "#fab219", bar: "#fab219" },
  low: { label: "Low", icon: "▸", color: "#9aa0ad", bar: "#9aa0ad" },
};

const CATEGORY_LABEL: Record<Insight["category"], string> = {
  routing: "Routing",
  caching: "Caching",
};

export function InsightsPanel({
  insights,
  potentialMonthlySavingsUsd,
}: {
  insights: Insight[];
  potentialMonthlySavingsUsd: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span aria-hidden>💡</span> Cost Insights
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Ranked by absolute monthly saving
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-success">
            {formatUsd(potentialMonthlySavingsUsd)}
          </p>
          <p className="text-xs text-text-muted">recoverable / mo</p>
        </div>
      </div>

      {insights.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          No optimization opportunities detected in this window. 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {insights.map((ins) => {
            const sev = SEVERITY[ins.severity];
            return (
              <li
                key={ins.id}
                className="relative overflow-hidden rounded-lg border border-border bg-surface-2 p-4 pl-5"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: sev.bar }}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium"
                        style={{ color: sev.color }}
                      >
                        <span aria-hidden>{sev.icon}</span>
                        {sev.label}
                      </span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                        {CATEGORY_LABEL[ins.category]}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium">{ins.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      {ins.detail}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-success">
                      {formatUsd(ins.monthlySavingsUsd)}
                    </p>
                    <p className="text-[10px] text-text-muted">/ mo</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
