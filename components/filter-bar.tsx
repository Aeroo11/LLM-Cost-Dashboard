"use client";

import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ENDPOINT_IDS, STATUS_IDS, type MetricFilters } from "@/lib/db/filters";
import type { FilterDimension } from "@/hooks/use-dashboard-state";

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
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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

        <div className="ml-auto flex items-center gap-3 text-xs text-text-muted">
          {matchedRequests !== null && (
            <span className="tabular-nums">
              {matchedRequests.toLocaleString()} matching
            </span>
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-border px-2 py-1 transition-colors hover:border-text-muted/50 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "border-accent/60 bg-accent/15 text-text"
          : "border-border text-text-muted hover:border-text-muted/50 hover:text-text"
      }`}
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
