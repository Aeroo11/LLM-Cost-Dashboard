"use client";

import { useCallback, useEffect, useState } from "react";
import type { LLMRequest, ModelId, RequestStatus } from "@/lib/types";
import type { RequestSortKey } from "@/lib/db/queries";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS } from "@/lib/palette";
import { formatMs, formatTokens, formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Zap,
} from "lucide-react";

/**
 * The raw events behind the aggregates.
 *
 * An aggregate you cannot drill into is a number you have to take on faith, so
 * every KPI on this page is one click from the rows that produced it. Sorting
 * and paging run in SQL — the table never holds more than one page.
 */

const PAGE_SIZE = 25;

interface Page {
  rows: LLMRequest[];
  total: number;
}

const COLUMNS: Array<{
  key: RequestSortKey | null;
  label: string;
  align?: "right";
}> = [
  { key: "ts", label: "Time" },
  { key: null, label: "Model" },
  { key: null, label: "Endpoint" },
  { key: "input_tokens", label: "Tokens", align: "right" },
  { key: "latency_ms", label: "Latency", align: "right" },
  { key: null, label: "Status" },
  { key: "cost_usd", label: "Cost", align: "right" },
];

const STATUS_STYLE: Record<RequestStatus, string> = {
  success: "text-text-muted",
  error: "text-danger",
  rate_limited: "text-warning",
  timeout: "text-warning",
};

export function RequestsTable({ queryString }: { queryString: string }) {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<RequestSortKey>("ts");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState<string | null>(null);
  /** The page currently displayed, tagged with the query that produced it. */
  const [loaded, setLoaded] = useState<{ key: string; page: Page } | null>(null);

  const resetKey = `${queryString}|${sort}|${direction}`;
  const fetchKey = `${resetKey}|${offset}`;

  // Changing the filters or the sort invalidates the current offset — staying
  // on page 7 of a result set that now has two pages shows an empty table.
  // Adjusted during render rather than in an effect, so the stale offset is
  // never committed and no extra request goes out for it.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setOffset(0);
  }

  // Derived, not stored: the table is stale exactly when the page on screen was
  // fetched for a different query than the one currently requested.
  const page = loaded?.page ?? null;
  const pending = loaded === null || loaded.key !== fetchKey;

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams(queryString);
    params.set("sort", sort);
    params.set("dir", direction);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    fetch(`/api/requests?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Page>;
      })
      .then((data) => {
        setLoaded({ key: fetchKey, page: data });
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });

    return () => controller.abort();
  }, [fetchKey, queryString, sort, direction, offset]);

  const toggleSort = useCallback(
    (key: RequestSortKey) => {
      if (key === sort) setDirection((d) => (d === "desc" ? "asc" : "desc"));
      else {
        setSort(key);
        setDirection("desc");
      }
    },
    [sort],
  );

  const total = page?.total ?? 0;
  const shown = page?.rows.length ?? 0;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  scope="col"
                  className={`px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted ${
                    col.align === "right" ? "text-right" : ""
                  }`}
                  aria-sort={
                    col.key && col.key === sort
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key!)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {col.label}
                      <SortIcon active={col.key === sort} direction={direction} />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 transition-colors hover:bg-surface-2/60"
              >
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs text-text-muted">
                  {new Date(r.timestamp).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: MODEL_COLORS[r.model as ModelId] }}
                      aria-hidden
                    />
                    {MODELS[r.model].label}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-text-muted">{r.endpoint}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-text-muted">
                  {formatTokens(r.inputTokens)}
                  <ArrowRight
                    size={11}
                    strokeWidth={1.75}
                    aria-hidden
                    className="mx-1 inline shrink-0 align-[-0.1em] opacity-40"
                  />
                  {formatTokens(r.outputTokens)}
                  {r.cachedTokens > 0 && (
                    <span
                      className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-eyebrow text-success"
                      title={`${formatTokens(r.cachedTokens)} served from cache`}
                    >
                      <Zap size={11} strokeWidth={1.75} aria-hidden className="shrink-0" />
                      {Math.round((r.cachedTokens / Math.max(r.inputTokens, 1)) * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">
                  {formatMs(r.latencyMs)}
                </td>
                <td className={`px-2 py-1.5 text-xs ${STATUS_STYLE[r.status]}`}>
                  {r.status.replace("_", " ")}
                </td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                  {formatUsd(r.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger">Failed to load requests: {error}</p>
      )}
      {!error && page && shown === 0 && (
        <p className="py-8 text-center text-sm text-text-muted">
          No requests match the current filters.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-text-muted">
        <span className="tabular-nums">
          {total > 0
            ? `${(offset + 1).toLocaleString()}–${(offset + shown).toLocaleString()} of ${total.toLocaleString()}`
            : "—"}
          {pending && <span className="ml-2 opacity-60">updating…</span>}
        </span>
        <span className="flex gap-2">
          <PagerButton
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            <ChevronLeft size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
            Prev
          </PagerButton>
          <PagerButton
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
          </PagerButton>
        </span>
      </div>
    </div>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 transition-colors duration-150 enabled:hover:border-border-strong enabled:hover:text-text disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

/**
 * The neutral state is a distinct glyph rather than a faded arrow, so "not
 * sorted by this column" never reads as "sorted, dimly".
 */
function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <Icon
      size={12}
      strokeWidth={1.75}
      aria-hidden
      className={cn("shrink-0", active ? "text-text" : "text-text-subtle")}
    />
  );
}
