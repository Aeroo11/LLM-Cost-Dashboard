"use client";

import type { Anomaly } from "@/lib/db/anomalies";
import type { ReactNode } from "react";
import { SEVERITY_COLOR } from "@/lib/palette";
import { formatEventTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Card } from "./ui/card";

export function AlertsPanel({
  anomalies,
  selectedId,
  onSelect,
  disabled,
  expanded = false,
  footer,
}: {
  anomalies: Anomaly[];
  selectedId?: string;
  onSelect: (anomaly: Anomaly) => void;
  disabled: boolean;
  expanded?: boolean;
  footer?: ReactNode;
}) {
  const rows = expanded ? anomalies : anomalies.slice(0, 3);

  function row(anomaly: Anomaly) {
    return (
      <li key={anomaly.id}>
        <button
          type="button"
          onClick={() => onSelect(anomaly)}
          disabled={disabled}
          aria-pressed={selectedId === anomaly.id}
          className={cn(
            "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-control py-2.5 text-left enabled:hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent",
            selectedId === anomaly.id && "bg-accent-soft",
          )}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[anomaly.severity] }} aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-text">{anomaly.title}</span>
            <span className="mt-0.5 block text-xs text-text-muted">{formatEventTime(anomaly.at)}</span>
            {expanded && <span className="mt-1 block text-xs leading-relaxed text-text-muted">{anomaly.detail}</span>}
          </span>
          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium capitalize" style={{ color: SEVERITY_COLOR[anomaly.severity] }}>
            {anomaly.severity}
          </span>
        </button>
      </li>
    );
  }

  return (
    <Card className="self-start">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="anomalies-heading" tabIndex={-1} className="flex scroll-mt-4 items-center gap-2 rounded-sm text-sm font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-accent">
          <TriangleAlert size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-warning" />
          {expanded ? "Detected anomalies" : "Recent anomalies"}
        </h2>
        {anomalies.length > 0 && (
          <span className="shrink-0 rounded-sm bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning tabular-nums">
            {anomalies.length}
          </span>
        )}
      </div>

      {anomalies.length === 0 ? (
        <p className="flex items-center gap-2 pt-3 text-xs text-text-muted">
          <CircleCheck
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-success"
          />
          Nothing unusual in this window.
        </p>
      ) : (
        <ul className="divide-y divide-border">{rows.map(row)}</ul>
      )}
      {footer && <div className="mt-1 border-t border-border pt-2">{footer}</div>}
    </Card>
  );
}
