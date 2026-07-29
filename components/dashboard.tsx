"use client";

import { useCallback, useEffect, useState } from "react";
import type { MetricsResponse, WindowKey } from "@/lib/api-types";
import { WINDOWS } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import {
  formatInt,
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import { KpiCard } from "./kpi-card";
import { Panel, LegendDot } from "./panel";
import { InsightsPanel } from "./insights-panel";
import { CostOverTime } from "./charts/cost-over-time";
import { CostByModel } from "./charts/cost-by-model";
import { CostVsQuality } from "./charts/cost-vs-quality";

const POLL_MS = 5000;

export function Dashboard() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async (key: WindowKey, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/metrics?window=${key}`, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MetricsResponse;
      setData(json);
      setError(null);
      setLive(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setLive(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(windowKey, controller.signal);
    const id = setInterval(() => load(windowKey), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [windowKey, load]);

  const s = data?.summary;
  const d = data?.deltas;
  const loading = !data;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs text-accent">TokenWatch</p>
          <h1 className="text-xl font-semibold tracking-tight">LLM Cost Intelligence</h1>
        </div>
        <div className="flex items-center gap-3">
          <LiveDot live={live} error={!!error} />
          <WindowToggle value={windowKey} onChange={setWindowKey} />
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          Failed to load metrics: {error}
        </p>
      )}

      {/* KPI row */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* Meta strip */}
      <section className="mt-4 flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm">
        <Meta label="Requests" value={s ? formatInt(s.totalRequests) : "—"} />
        <Meta label="p95 latency" value={s ? formatMs(s.latencyP95) : "—"} />
        <Meta label="p99 latency" value={s ? formatMs(s.latencyP99) : "—"} />
        <Meta label="Tokens in" value={s ? formatTokens(s.totalInputTokens) : "—"} />
        <Meta label="Tokens out" value={s ? formatTokens(s.totalOutputTokens) : "—"} />
        <Meta label="Cached" value={s ? formatTokens(s.totalCachedTokens) : "—"} />
      </section>

      {loading || !data || !s ? (
        <section className="mt-4 rounded-xl border border-dashed border-border bg-surface/40 px-5 py-16 text-center text-sm text-text-muted">
          Loading charts…
        </section>
      ) : (
        <>
          {/* Insights headline */}
          <div className="mt-4">
            <InsightsPanel
              insights={data.insights}
              potentialMonthlySavingsUsd={data.potentialMonthlySavingsUsd}
            />
          </div>

          {/* Cost over time */}
          <Panel
            title="Cost over time"
            subtitle={`Stacked by model · last ${WINDOWS[windowKey].label}`}
            className="mt-4"
            action={<ModelLegend />}
          >
            <CostOverTime data={s.timeSeries} windowKey={windowKey} />
          </Panel>

          {/* Two-up */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Cost by model" subtitle="Who spends the budget">
              <CostByModel byModel={s.byModel} total={s.totalCostUsd} />
            </Panel>
            <Panel
              title="Cost vs quality"
              subtitle="Bubble = total spend · bottom-right = overpaying"
              action={<ModelLegend />}
            >
              <CostVsQuality byModel={s.byModel} />
            </Panel>
          </div>
        </>
      )}

      <footer className="mt-8 text-center text-xs text-text-muted">
        Simulated data · updates every {POLL_MS / 1000}s ·{" "}
        <span className="font-mono">TokenWatch</span> demo
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
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            value === key ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
          }`}
        >
          {WINDOWS[key].label}
        </button>
      ))}
    </div>
  );
}

function LiveDot({ live, error }: { live: boolean; error: boolean }) {
  const color = error ? "bg-danger" : live ? "bg-success" : "bg-text-muted";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-text-muted">
      <span className="relative flex h-2 w-2">
        {live && !error && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {error ? "disconnected" : live ? "live" : "connecting"}
    </span>
  );
}
