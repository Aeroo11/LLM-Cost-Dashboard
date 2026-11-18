import type { Insight, InsightSeverity, SavingsBreakdown } from "@/lib/insights";
import { formatUsd } from "@/lib/format";
import { SEVERITY_COLOR } from "@/lib/palette";
import {
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  Lightbulb,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { Card } from "./ui/card";

/** Ordinal icons, because severity is ordinal — the glyph carries the rank too. */
const SEVERITY_LABEL: Record<InsightSeverity, { label: string; icon: LucideIcon }> = {
  high: { label: "High impact", icon: ChevronsUp },
  medium: { label: "Medium", icon: ChevronUp },
  low: { label: "Low", icon: Minus },
};

const CATEGORY_LABEL: Record<Insight["category"], string> = {
  routing: "Routing",
  caching: "Caching",
};

export function InsightsPanel({
  insights,
  savings,
}: {
  insights: Insight[];
  savings: SavingsBreakdown;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Lightbulb
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-text-subtle"
            />
            Cost Insights
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Ranked by absolute monthly saving
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-success">
            {formatUsd(savings.measuredUsd)}
          </p>
          <p className="text-xs text-text-muted">
            measured / mo
            {savings.assumedUsd > 0 && (
              <>
                {" · "}
                <span className="text-text-muted/80">
                  +{formatUsd(savings.assumedUsd)} est.
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {insights.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-text-muted">
          <CircleCheck
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-success"
          />
          No optimization opportunities detected in this window.
        </p>
      ) : (
        <ul className="space-y-3">
          {insights.map((ins) => (
            <InsightRow key={ins.id} insight={ins} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function InsightRow({ insight: ins }: { insight: Insight }) {
  const sev = SEVERITY_LABEL[ins.severity];
  const SevIcon = sev.icon;
  const color = SEVERITY_COLOR[ins.severity];
  return (
    <li className="relative overflow-hidden rounded-lg border border-border bg-surface-2 p-4 pl-5">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 text-eyebrow font-medium"
              style={{ color }}
            >
              <SevIcon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
              {sev.label}
            </span>
            <Tag>{CATEGORY_LABEL[ins.category]}</Tag>
            <Tag
              title={
                ins.basis === "measured"
                  ? "Re-priced directly from the observed events in this window."
                  : ins.assumption
              }
            >
              {ins.basis === "measured" ? "measured" : "estimate"}
            </Tag>
          </div>

          <h3 className="text-sm font-medium">{ins.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{ins.detail}</p>

          {/* The cost of taking the advice, stated next to the benefit. */}
          {ins.qualityDelta !== undefined && (
            <p className="mt-1.5 text-xs text-warning">
              Trade-off: average quality {ins.qualityDelta >= 0 ? "+" : ""}
              {ins.qualityDelta.toFixed(3)} on affected calls
            </p>
          )}
          {ins.assumption && (
            <p className="mt-1.5 text-xs italic leading-relaxed text-text-muted/80">
              {ins.assumption}
            </p>
          )}
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
}

function Tag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
    >
      {children}
    </span>
  );
}
