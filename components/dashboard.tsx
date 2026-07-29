"use client";

import { useEffect, useState } from "react";
import { WINDOWS, WINDOW_KEYS, type WindowKey } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import {
  formatInt,
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import { useDashboardState } from "@/hooks/use-dashboard-state";
import { useMetricsStream, type ConnectionState } from "@/hooks/use-metrics-stream";
import { cn } from "@/lib/cn";
import { Cpu, Gauge, Network, Table2, TrendingUp } from "lucide-react";
import { KpiCard } from "./kpi-card";
import { Card } from "./ui/card";
import { Panel, LegendDot } from "./panel";
import { InsightsPanel } from "./insights-panel";
import { AlertsPanel } from "./alerts-panel";
import { FilterBar } from "./filter-bar";
import { RequestsTable } from "./requests-table";
import { SimulatorPanel } from "./simulator-panel";
import { CostOverTime } from "./charts/cost-over-time";
import { CostByModel } from "./charts/cost-by-model";
import { CostByEndpoint } from "./charts/cost-by-endpoint";
import { CostVsQuality } from "./charts/cost-vs-quality";

export function Dashboard() {
  const {
    windowKey,
    filters,
    queryString,
    hasFilters,
    setWindow,
    toggleFilter,
    clearFilters,
  } = useDashboardState();

  const { data, status, lastUpdateMs, error } = useMetricsStream(queryString);

  const s = data?.summary;
  const d = data?.deltas;
  const loading = !data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs text-accent">TokenWatch</p>
          <h1 className="text-xl font-semibold tracking-tight">LLM Cost Intelligence</h1>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator status={status} lastUpdateMs={lastUpdateMs} />
          <WindowToggle value={windowKey} onChange={setWindow} />
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <section className="mt-6">
        <FilterBar
          filters={filters}
          hasFilters={hasFilters}
          matchedRequests={s?.totalRequests ?? null}
          onToggle={toggleFilter}
          onClear={clearFilters}
        />
      </section>

      {/* KPI row */}
      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Cost"
          value={s ? formatUsd(s.totalCostUsd) : "—"}
          sub={`over the last ${WINDOWS[windowKey].label}`}
          deltaPct={d?.totalCostPct}
          invertDelta
          accent
          loading={loading}
        />
        <KpiCard
          label="Burn Rate"
          value={s ? formatUsd(s.burnRateMonthlyUsd) : "—"}
          sub="projected 30-day spend"
          loading={loading}
        />
        <KpiCard
          label="Avg Cost / Request"
          value={s ? formatUsd(s.avgCostPerRequest) : "—"}
          sub={s ? `${formatInt(s.totalRequests)} requests` : undefined}
          deltaPct={d?.avgCostPct}
          invertDelta
          loading={loading}
        />
        <KpiCard
          label="Error Rate"
          value={s ? formatPercent(s.errorRate) : "—"}
          sub="failed / rate-limited / timeout"
          deltaPct={d?.errorRatePct}
          invertDelta
          loading={loading}
        />
      </section>

      <Card as="section" padded={false} className="mt-4 flex flex-wrap gap-x-6 gap-y-2 px-5 py-3 text-sm">
        <Meta label="p50" value={s ? formatMs(s.latencyP50) : "—"} />
        <Meta label="p95" value={s ? formatMs(s.latencyP95) : "—"} />
        <Meta label="p99" value={s ? formatMs(s.latencyP99) : "—"} />
        <Meta label="Tokens in" value={s ? formatTokens(s.totalInputTokens) : "—"} />
        <Meta label="Tokens out" value={s ? formatTokens(s.totalOutputTokens) : "—"} />
        <Meta label="Cached" value={s ? formatTokens(s.totalCachedTokens) : "—"} />
      </Card>

      {loading || !data || !s ? (
        <section className="mt-4 rounded-xl border border-dashed border-border bg-surface/40 px-5 py-20 text-center text-sm text-text-muted">
          Connecting to the metrics stream…
        </section>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightsPanel insights={data.insights} savings={data.savings} />
            <AlertsPanel anomalies={data.anomalies} />
          </div>

          <Panel
            title="Cost over time"
            subtitle={`Stacked by model · last ${WINDOWS[windowKey].label}`}
            icon={TrendingUp}
            className="mt-4"
            action={<ModelLegend />}
          >
            <CostOverTime data={s.timeSeries} windowKey={windowKey} />
          </Panel>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel
              title="Cost by endpoint"
              subtitle="Stacked by model · click a bar to drill in"
              icon={Network}
              action={<ModelLegend />}
            >
              <CostByEndpoint
                cells={data.endpointMatrix}
                selected={filters.endpoints}
                onSelect={(endpoint) => toggleFilter("endpoints", endpoint)}
              />
            </Panel>
            <Panel title="Cost by model" subtitle="Who spends the budget" icon={Cpu}>
              <CostByModel byModel={s.byModel} total={s.totalCostUsd} />
            </Panel>
          </div>

          <Panel
            title="Cost vs quality"
            subtitle="Bubble = total spend · bottom-right = overpaying"
            icon={Gauge}
            className="mt-4"
            action={<ModelLegend />}
          >
            <CostVsQuality byModel={s.byModel} />
          </Panel>

          <div className="mt-4">
            <SimulatorPanel queryString={queryString} />
          </div>

          <Panel
            title="Requests"
            subtitle="The raw events behind every number above"
            icon={Table2}
            className="mt-4"
          >
            <RequestsTable queryString={queryString} />
          </Panel>
        </>
      )}

      <footer className="mt-8 space-y-1 text-center text-xs text-text-muted">
        <p>
          Simulated traffic · streamed over SSE ·{" "}
          <span className="font-mono">TokenWatch</span> demo
        </p>
        <p className="opacity-70">
          Pricing is representative, not a live price book. Savings marked
          &ldquo;estimate&rdquo; rest on stated assumptions.
        </p>
      </footer>
    </div>
  );
}

function ModelLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {MODEL_ORDER.map((m) => (
        <LegendDot key={m} color={MODEL_COLORS[m]} label={MODELS[m].label} />
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function WindowToggle({
  value,
  onChange,
}: {
  value: WindowKey;
  onChange: (k: WindowKey) => void;
}) {
  return (
    <div className="inline-flex rounded-control border border-border bg-surface p-0.5 shadow-panel">
      {WINDOW_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            "rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium",
            "transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            value === key ? "bg-surface-2 text-text" : "text-text-muted hover:text-text",
          )}
        >
          {WINDOWS[key].label}
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<ConnectionState, { color: string; label: string; pulse: boolean }> = {
  connecting: { color: "bg-text-muted", label: "connecting", pulse: false },
  live: { color: "bg-success", label: "live", pulse: true },
  reconnecting: { color: "bg-warning", label: "reconnecting", pulse: false },
  error: { color: "bg-danger", label: "disconnected", pulse: false },
};

/**
 * Connection state, honestly reported. The previous version animated a "live"
 * dot regardless of what was actually happening; this reflects the real state
 * of the EventSource and how long ago the last frame landed.
 */
function LiveIndicator({
  status,
  lastUpdateMs,
}: {
  status: ConnectionState;
  lastUpdateMs: number | null;
}) {
  const style = STATUS_STYLE[status];

  // Seconds since the last frame, counted rather than measured. Reading the
  // clock during render would make this component impure — the same props
  // would produce different output — so a ticker owns the elapsed time and it
  // resets when a new frame arrives.
  const [secondsSinceFrame, setSecondsSinceFrame] = useState(0);
  const [frameAt, setFrameAt] = useState(lastUpdateMs);
  if (frameAt !== lastUpdateMs) {
    setFrameAt(lastUpdateMs);
    setSecondsSinceFrame(0);
  }

  useEffect(() => {
    if (lastUpdateMs === null) return;
    const id = setInterval(() => setSecondsSinceFrame((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [lastUpdateMs]);

  const agoSeconds = lastUpdateMs === null ? null : secondsSinceFrame;

  return (
    <span className="inline-flex items-center gap-2 text-xs text-text-muted">
      <span className="relative flex h-2 w-2">
        {style.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.color} opacity-60`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${style.color}`} />
      </span>
      {style.label}
      {agoSeconds !== null && status === "live" && (
        <span className="tabular-nums opacity-70">· {agoSeconds}s ago</span>
      )}
    </span>
  );
}
