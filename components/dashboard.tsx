"use client";

import { Activity as ViewActivity, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WINDOWS, WINDOW_KEYS, type WindowKey } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { formatEventTime, formatInt, formatMs, formatPercent, formatUsd } from "@/lib/format";
import type { Insight } from "@/lib/insights";
import type { Anomaly } from "@/lib/db/anomalies";
import type { RoutingOverride } from "@/lib/db/simulate";
import { DASHBOARD_VIEWS, type DashboardView } from "@/lib/dashboard-views";
import { useDashboardState } from "@/hooks/use-dashboard-state";
import { useMetricsStream, type ConnectionState } from "@/hooks/use-metrics-stream";
import { cn } from "@/lib/cn";
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  Cpu,
  DollarSign,
  Gauge,
  Network,
  Receipt,
  Table2,
  Timer,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { StatTile } from "./ui/stat-tile";
import { Card } from "./ui/card";
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
import { DashboardShell, DashboardViewLink } from "./dashboard-shell";

export function Dashboard() {
  const {
    view,
    getViewHref,
    setView,
    windowKey,
    filters,
    queryString,
    hasFilters,
    setWindow,
    toggleFilter,
    clearFilters,
  } = useDashboardState();

  const { data, stale, status, lastUpdateMs, error } = useMetricsStream(queryString);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);
  const costTrendRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const focusTrendOnOverview = useRef(false);
  const [routingPreset, setRoutingPreset] = useState<RoutingOverride>();
  const [selection, setSelection] = useState<{
    queryString: string;
    anomaly: Anomaly;
    endMs: number;
  } | null>(null);

  const s = data?.summary;
  const d = data?.deltas;
  const loading = !data;
  const selected = selection?.queryString === queryString && data && !stale
    && selection.anomaly.at >= data.range.fromMs ? selection : null;
  const showComparison = data?.comparisonAvailable === true && !stale;

  const requestParams = new URLSearchParams(queryString);
  if (selected) {
    requestParams.set("from", String(selected.anomaly.at));
    requestParams.set("to", String(selected.endMs));
  }

  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;

    const trend = view === "overview" && focusTrendOnOverview.current ? costTrendRef.current : null;
    focusTrendOnOverview.current = false;
    if (trend) {
      trend.focus({ preventScroll: true });
      trend.scrollIntoView({ block: "start" });
    } else {
      viewHeadingRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [view]);

  function navigateView(next: DashboardView) {
    if (next !== view) {
      setView(next);
    } else {
      viewHeadingRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function selectAnomaly(anomaly: Anomaly) {
    if (!data || stale) return;

    setSelection({
      queryString,
      anomaly,
      endMs: Math.min(anomaly.at + WINDOWS[data.windowKey].bucketMinutes * 60_000, data.range.toMs),
    });
    if (view === "overview") {
      costTrendRef.current?.focus({ preventScroll: true });
      costTrendRef.current?.scrollIntoView({ block: "start" });
    } else {
      focusTrendOnOverview.current = true;
      setView("overview");
    }
  }

  function testRouting(routing: NonNullable<Insight["routing"]>) {
    setRoutingPreset({ ...routing, share: 0.5 });
    navigateView("simulator");
  }

  const routingOpportunity = data?.insights.find((insight) => insight.routing);

  return (
    <DashboardShell view={view} getViewHref={getViewHref} onViewNavigate={navigateView}>
      <div className="min-w-0 px-4 pb-10 sm:px-7 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-5 sm:py-6">
          <div>
            <h1 ref={viewHeadingRef} id="dashboard-main" tabIndex={-1} className="rounded-sm text-[1.8rem] leading-tight font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-accent sm:text-[2.1rem]">
              {DASHBOARD_VIEWS[view]}
            </h1>
            <p className="mt-1 text-xs text-text-muted lg:hidden">Simulated traffic</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LiveIndicator status={status} lastUpdateMs={lastUpdateMs} />
            <WindowToggle value={windowKey} onChange={setWindow} />
          </div>
        </header>

        {error && (
          <p role="alert" className="mt-4 rounded-control border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div>
          <FilterBar
            filters={filters}
            hasFilters={hasFilters}
            matchedRequests={s?.totalRequests ?? null}
            onToggle={toggleFilter}
            onClear={clearFilters}
          />
        </div>

        {view === "overview" && (
          <>
            {data && (
              <DashboardViewLink
                view="anomalies"
                getViewHref={getViewHref}
                onViewNavigate={navigateView}
                className="mt-3 inline-flex items-center gap-2 rounded-control text-xs font-medium text-text-muted hover:text-text focus-visible:ring-2 focus-visible:ring-accent xl:hidden"
              >
                <TriangleAlert size={14} className={data.anomalies.length ? "text-warning" : undefined} aria-hidden />
                {data.anomalies.length} {data.anomalies.length === 1 ? "anomaly" : "anomalies"} in view
                <ArrowDown size={12} aria-hidden />
              </DashboardViewLink>
            )}

            <section aria-label="Key metrics" className={cn("mt-5 overflow-hidden rounded-panel border border-border bg-surface shadow-panel", stale && "opacity-60")}>
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                <StatTile
                  primary
                  label="Total spend"
                  value={s ? formatUsd(s.totalCostUsd) : "—"}
                  sub={`Last ${WINDOWS[windowKey].label}`}
                  deltaPct={d?.totalCostPct}
                  showComparison={showComparison}
                  invertDelta
                  icon={DollarSign}
                  loading={loading}
                />
                <StatTile
                  label="30-day forecast"
                  value={s ? formatUsd(s.burnRateMonthlyUsd) : "—"}
                  sub="At the current spend rate"
                  icon={TrendingUp}
                  loading={loading}
                />
                <StatTile
                  label="Error rate"
                  value={s ? formatPercent(s.errorRate) : "—"}
                  sub="Failed requests"
                  deltaPct={d?.errorRatePct}
                  showComparison={showComparison}
                  invertDelta
                  icon={TriangleAlert}
                  loading={loading}
                />
                <StatTile
                  label="p95 latency"
                  value={s?.totalRequests ? formatMs(s.latencyP95) : "—"}
                  sub="Across matching requests"
                  icon={Timer}
                  loading={loading}
                />
              </div>
              {data && !stale && !data.comparisonAvailable && (
                <p className="border-t border-border px-4 py-2 text-xs text-text-muted">Comparison data unavailable for the previous period.</p>
              )}
            </section>

            <div className={cn("mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_304px]", stale && "opacity-60")}>
              <div className="min-w-0">

                {data && s ? (
                  <section
                    ref={costTrendRef}
                    id="cost-trend"
                    tabIndex={-1}
                    aria-label="Cost trend"
                    className="scroll-mt-4 rounded-panel focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Panel
                      title="Cost over time"
                      subtitle={`USD per ${WINDOWS[data.windowKey].bucketMinutes < 60
                        ? `${WINDOWS[data.windowKey].bucketMinutes}-minute interval`
                        : `${WINDOWS[data.windowKey].bucketMinutes / 60}-hour interval`}`}
                      action={data.anomalies.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                          <span className="size-2 rounded-full bg-warning" aria-hidden /> Anomaly
                        </span>
                      )}
                    >
                      <div aria-live="polite">
                        {selected && (
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-warning/25 bg-warning/5 px-3 py-2.5">
                            <div>
                              <p className="text-sm text-text">
                                <span className="font-medium">{selected.anomaly.title}</span>{" "}
                                <span className="text-text-muted">at {formatEventTime(selected.anomaly.at)}</span>
                              </p>
                              <p className="mt-0.5 text-xs text-text-muted">{selected.anomaly.detail}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                              <DashboardViewLink view="requests" getViewHref={getViewHref} onViewNavigate={navigateView} className="rounded-sm font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent">
                                View related requests
                              </DashboardViewLink>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelection(null);
                                  costTrendRef.current?.focus({ preventScroll: true });
                                }}
                                className="rounded-sm text-text-muted hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                Clear selection
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <CostOverTime
                        data={s.timeSeries}
                        windowKey={data.windowKey}
                        selectedAt={selected?.anomaly.at}
                        anomalyTimes={data.anomalies.slice(0, 3).map(({ at }) => at)}
                      />
                    </Panel>
                  </section>
                ) : <ChartSkeleton height={300} className="xl:min-h-[480px]" />}
              </div>

              <aside aria-label="Anomalies and savings" className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-1">
                {data ? (
                  <>
                    <AlertsPanel
                      anomalies={data.anomalies}
                      selectedId={selected?.anomaly.id}
                      onSelect={selectAnomaly}
                      disabled={stale}
                      footer={
                        <DashboardViewLink view="anomalies" getViewHref={getViewHref} onViewNavigate={navigateView} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent">
                          View all anomalies <ArrowUpRight size={13} aria-hidden />
                        </DashboardViewLink>
                      }
                    />
                    <CostOpportunity insight={routingOpportunity} onTest={testRouting} disabled={stale} />
                  </>
                ) : <PanelSkeleton lines={3} />}
              </aside>
            </div>

            {data && s && (
              <section aria-label="Usage and latency" className={cn("mt-8 space-y-4", stale && "opacity-60")}>
                <h2 className="border-b border-border pb-3 text-lg font-semibold tracking-tight">Usage and latency</h2>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-border bg-border">
                  <StatTile
                    label="Requests"
                    value={formatInt(s.totalRequests)}
                    sub="Matching the current filters"
                    deltaPct={d?.requestsPct}
                    showComparison={showComparison}
                    icon={Activity}
                  />
                  <StatTile
                    label="Avg. cost per request"
                    value={s.totalRequests ? formatUsd(s.avgCostPerRequest) : "—"}
                    sub="Across matching requests"
                    deltaPct={d?.avgCostPct}
                    showComparison={showComparison}
                    invertDelta
                    icon={Receipt}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <LatencyCard summary={s} />
                  <TokenFlowCard summary={s} />
                </div>
              </section>
            )}
          </>
        )}

        {view === "cost-breakdown" && (data && s ? (
          <section aria-label="Cost breakdown charts" className={cn("mt-5 space-y-4", stale && "opacity-60")}>
            <div className="flex justify-end">
              <Link href="#cost-insights" replace className="rounded-sm text-xs font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent">
                View cost insights
              </Link>
            </div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <Panel title="Cost by model" icon={Cpu}>
                <CostByModel byModel={s.byModel} total={s.totalCostUsd} />
              </Panel>
              <Panel title="Cost by endpoint" subtitle="Select a bar to filter" icon={Network}>
                <CostByEndpoint
                  cells={data.endpointMatrix}
                  selected={filters.endpoints}
                  onSelect={(endpoint) => toggleFilter("endpoints", endpoint)}
                />
                <div className="mt-3"><ModelLegend /></div>
              </Panel>
            </div>
            <EndpointEconomics summary={s} />
            <Panel
              title="Cost vs quality"
              subtitle="Estimated quality score · bubble size shows total spend"
              icon={Gauge}
              action={<ModelLegend />}
            >
              <CostVsQuality byModel={s.byModel} />
            </Panel>
            <section id="cost-insights" tabIndex={-1} aria-label="Cost insights" className="scroll-mt-4 rounded-panel focus-visible:ring-2 focus-visible:ring-accent">
              <InsightsPanel insights={data.insights} savings={data.savings} />
            </section>
          </section>
        ) : <ChartSkeleton height={300} className="mt-5" />)}

        {view === "anomalies" && (
          <div className={cn("mt-5", stale && "opacity-60")}>
            {data ? (
              <AlertsPanel
                anomalies={data.anomalies}
                selectedId={selected?.anomaly.id}
                onSelect={selectAnomaly}
                disabled={stale}
                expanded
              />
            ) : <PanelSkeleton lines={3} />}
          </div>
        )}

        <ViewActivity mode={view === "simulator" ? "visible" : "hidden"}>
          <section aria-label="What-if simulator" className="mt-5">
            <SimulatorPanel queryString={queryString} preset={routingPreset} />
          </section>
        </ViewActivity>

        <ViewActivity mode={view === "requests" ? "visible" : "hidden"}>
          <section aria-label={selected ? "Related requests" : "Request log"} className="mt-5">
            {data ? (
              <Panel
                title={selected ? "Related requests" : "Request log"}
                subtitle={selected
                  ? `${formatEventTime(selected.anomaly.at)} to ${formatEventTime(selected.endMs)} (local time)`
                  : "Request-level cost, usage, and performance"}
                icon={Table2}
                action={selected && (
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="rounded-sm text-xs font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Clear anomaly filter
                  </button>
                )}
              >
                <RequestsTable key={selected?.anomaly.id} queryString={requestParams.toString()} />
              </Panel>
            ) : <TableSkeleton />}
          </section>
        </ViewActivity>

        <footer className="mt-8 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
          Demo pricing is representative. Quality scores are simulated.
        </footer>
      </div>
    </DashboardShell>
  );
}

function CostOpportunity({ insight, onTest, disabled }: {
  insight?: Insight;
  onTest: (routing: NonNullable<Insight["routing"]>) => void;
  disabled: boolean;
}) {
  const routing = insight?.routing;

  return (
    <Card className="self-start">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <TrendingUp size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent" />
        Top routing opportunity
      </h2>
      {insight && routing ? (
        <>
          <p className="mt-3 text-sm leading-snug text-text-muted">{insight.title}</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <strong className="text-2xl font-semibold tracking-tight tabular-nums text-text">{formatUsd(insight.monthlySavingsUsd)}</strong>
            <span className="text-xs text-text-muted">projected savings / mo</span>
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onTest(routing)}
            className="mt-4 flex min-h-9 w-full items-center justify-center gap-2 rounded-control bg-accent px-3 text-xs font-semibold text-surface hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
          >
            Test 50% in simulator <ArrowUpRight size={14} aria-hidden />
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-text-muted">No routing opportunities in this view.</p>
      )}
    </Card>
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
            value === key ? "bg-accent-soft font-semibold text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {WINDOWS[key].label}
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<ConnectionState, { color: string; label: string }> = {
  connecting: { color: "bg-text-muted", label: "Connecting" },
  live: { color: "bg-success", label: "Live" },
  reconnecting: { color: "bg-warning", label: "Reconnecting" },
  error: { color: "bg-danger", label: "Disconnected" },
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
    <span className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs text-text-muted">
      <span className={cn("size-1.5 shrink-0 rounded-full", style.color)} aria-hidden />
      <span className={cn("font-medium", status === "live" && "text-success")}>{style.label}</span>
      {agoSeconds !== null && status === "live" && (
        <span className="tabular-nums">· {agoSeconds}s ago</span>
      )}
    </span>
  );
}
