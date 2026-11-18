"use client";

import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ENDPOINT_IDS, STATUS_IDS, type MetricFilters } from "@/lib/db/filters";
import type { FilterDimension } from "@/hooks/use-dashboard-state";
import { cn } from "@/lib/cn";
import { ChevronDown, ListFilter, X } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  success: "success",
  error: "error",
  rate_limited: "rate limited",
  timeout: "timeout",
};

export function FilterBar({
  filters,
  hasFilters,
  matchedRequests,
  onToggle,
  onClear,
}: {
  filters: MetricFilters;
  hasFilters: boolean;
  matchedRequests: number | null;
  onToggle: (dimension: FilterDimension, value: string) => void;
  onClear: () => void;
}) {
  const filterCount = filters.models.length + filters.endpoints.length + filters.statuses.length;

  return (
    <details className="group rounded-control border border-border bg-surface shadow-panel">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-control px-3 text-xs font-medium text-text-muted hover:text-text focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <ListFilter size={15} aria-hidden />
        <span className="text-text">Filters</span>
        {hasFilters && <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-accent">{filterCount} active</span>}
        <ChevronDown size={14} aria-hidden className="group-open:rotate-180" />
        {matchedRequests !== null && (
          <span className="ml-auto font-normal tabular-nums">{matchedRequests.toLocaleString()} matching requests</span>
        )}
      </summary>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border px-3 py-3">
        <Group label="Model">
          {MODEL_ORDER.map((id) => (
            <Chip
              key={id}
              active={filters.models.includes(id)}
              color={MODEL_COLORS[id]}
              onClick={() => onToggle("models", id)}
            >
              {MODELS[id].label}
            </Chip>
          ))}
        </Group>

        <Group label="Endpoint">
          {ENDPOINT_IDS.map((id) => (
            <Chip
              key={id}
              active={filters.endpoints.includes(id)}
              onClick={() => onToggle("endpoints", id)}
            >
              {id}
            </Chip>
          ))}
        </Group>

        <Group label="Status">
          {STATUS_IDS.map((id) => (
            <Chip
              key={id}
              active={filters.statuses.includes(id)}
              onClick={() => onToggle("statuses", id)}
            >
              {STATUS_LABEL[id] ?? id}
            </Chip>
          ))}
        </Group>

        {hasFilters && (
            <button
              type="button"
              onClick={onClear}
              className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-control border border-border px-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
              Clear filters
            </button>
        )}
      </div>
    </details>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="pt-2 text-xs text-text-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs",
        "transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active
          ? "border-accent/60 bg-accent/15 text-text"
          : "border-border text-text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-sm"
          style={{ backgroundColor: color, opacity: active ? 1 : 0.5 }}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
