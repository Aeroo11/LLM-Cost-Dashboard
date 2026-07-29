"use client";

import { useEffect, useState } from "react";
import { WINDOWS, WINDOW_KEYS, type WindowKey } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { formatInt, formatPercent, formatUsd } from "@/lib/format";
import { useDashboardState } from "@/hooks/use-dashboard-state";
import { useMetricsStream, type ConnectionState } from "@/hooks/use-metrics-stream";
import { cn } from "@/lib/cn";
import { toSparkline, toSparklineRequests } from "@/lib/series";
import {
  Activity,
  Cpu,
  DollarSign,
  Flame,
  Gauge,
  Network,
  Receipt,
  Table2,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { StatTile } from "./ui/stat-tile";
import { LatencyCard } from "./latency-card";
import { EndpointEconomics } from "./endpoint-economics";
import {
  ChartSkeleton,
  PanelSkeleton,
  TableSkeleton,
} from "./ui/skeleton";
import { TokenFlowCard } from "./token-flow-card";
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

  const { data, stale, status, lastUpdateMs, error } = useMetricsStream(queryString);

  const s = data?.summary;
  const d = data?.deltas;
  const loading = !data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs tracking-wide text-accent">TokenWatch</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
            LLM Cost Intelligence
          </h1>
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

      {/* Total Cost is the hero: one number the view leads with, at display
          size, with the other four reading as its supporting cast. */}
      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
        <StatTile
          size="hero"
          className="lg:col-span-2 lg:row-span-2"
          label="Total Cost"
          value={s ? formatUsd(s.totalCostUsd) : "—"}
          sub={`over the last ${WINDOWS[windowKey].label}`}
          deltaPct={d?.totalCostPct}
          invertDelta
          icon={DollarSign}
          trend={s ? toSparkline(s.timeSeries) : undefined}
          loading={loading}
        />
        <StatTile
          label="Burn Rate"
          value={s ? formatUsd(s.burnRateMonthlyUsd) : "—"}
          sub="projected 30-day spend"
          icon={Flame}
          loading={loading}
        />
        {/* The one metric where up is not bad — the only tile without
            invertDelta, which is what makes the colouring read as deliberate. */}
        <StatTile
          label="Requests"
          value={s ? formatInt(s.totalRequests) : "—"}
          sub="matching the current filters"
          deltaPct={d?.requestsPct}
          icon={Activity}
          trend={s ? toSparklineRequests(s.timeSeries) : undefined}
          loading={loading}
        />
        <StatTile
          label="Avg Cost / Request"
          value={s ? formatUsd(s.avgCostPerRequest) : "—"}
          sub="across every model"
          deltaPct={d?.avgCostPct}
          invertDelta
          icon={Receipt}
          loading={loading}
        />
        <StatTile
          label="Error Rate"
          value={s ? formatPercent(s.errorRate) : "—"}
          sub="failed / rate-limited / timeout"
          deltaPct={d?.errorRatePct}
          invertDelta
          icon={TriangleAlert}
          loading={loading}
        />
      </section>

      {loading || !data || !s ? (
        // Per-panel shapes at the real heights, so nothing shifts when the
        // first frame lands. The single dashed box this replaces collapsed the
        // whole lower page into 160px and then jumped it back open.
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PanelSkeleton lines={2} />
            <PanelSkeleton lines={2} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PanelSkeleton lines={3} />
            <PanelSkeleton lines={3} />
          </div>
          <ChartSkeleton height={260} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartSkeleton height={240} />
            <ChartSkeleton height={260} />
          </div>
          <TableSkeleton />
        </div>
      ) : (
        // Stale = the window or filters changed and this frame answers the
        // previous query. Hold it at reduced opacity rather than flashing a
        // skeleton — same treatment the simulator already gives its pending
        // state, so the pattern reads as deliberate.
        <div
          className={cn(
            "animate-rise transition-opacity duration-200",
            stale && "opacity-60",
          )}
        >
          {/* Still "what is true right now", so it stays close to the KPIs. */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LatencyCard summary={s} />
            <TokenFlowCard summary={s} />
          </div>

          {/* New band: what to do about it. */}
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightsPanel insights={data.insights} savings={data.savings} />
            <AlertsPanel anomalies={data.anomalies} />
          </div>

          {/* New band: the breakdowns behind those numbers. */}
          <Panel
            title="Cost over time"
            subtitle={`Stacked by model · last ${WINDOWS[windowKey].label}`}
            icon={TrendingUp}
            className="mt-8"
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

          {/* Directly after the endpoint spend chart: where the money goes,
              then whether it is well spent. */}
          <div className="mt-4">
            <EndpointEconomics summary={s} />
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

          {/* New band: a tool rather than a reading. */}
          <div className="mt-8">
            <SimulatorPanel queryString={queryString} />
          </div>

          {/* New band: the raw events everything above is derived from. */}
          <Panel
            title="Requests"
            subtitle="The raw events behind every number above"
            icon={Table2}
            className="mt-8"
          >
            <RequestsTable queryString={queryString} />
          </Panel>
        </div>
      )}

      <footer className="mt-12 space-y-1 text-center text-xs text-text-muted">
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
