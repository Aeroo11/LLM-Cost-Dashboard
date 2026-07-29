"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Endpoint, ModelId } from "@/lib/types";
import type { RoutingOverride, Scenario, ScenarioResult } from "@/lib/db/simulate";
import { MODELS } from "@/lib/models";
import { MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ENDPOINT_IDS } from "@/lib/db/filters";
import { formatUsd } from "@/lib/format";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Card } from "./ui/card";

/**
 * What-if simulator.
 *
 * Turns the dashboard from a report into a tool: instead of being told "route
 * classify to a cheaper model and save $X", you move the sliders yourself and
 * watch the projection respond — including the quality you give up, which is
 * shown next to the saving rather than buried.
 *
 * Every scenario is priced by re-running the real traffic through the price
 * book in SQL. The cost side is exact; the quality side is an estimate, and the
 * panel says which is which.
 */

const NONE = "__none__";

export function SimulatorPanel({ queryString }: { queryString: string }) {
  const [routing, setRouting] = useState<Record<string, { model: ModelId; share: number }>>({});
  const [cacheHitRate, setCacheHitRate] = useState<number | null>(null);
  const [trafficMultiplier, setTrafficMultiplier] = useState(1);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const scenario: Scenario = useMemo(
    () => ({
      routing: Object.entries(routing).map(
        ([endpoint, v]): RoutingOverride => ({
          endpoint: endpoint as Endpoint,
          targetModel: v.model,
          share: v.share,
        }),
      ),
      cacheHitRate,
      trafficMultiplier,
    }),
    [routing, cacheHitRate, trafficMultiplier],
  );

  const dirty =
    scenario.routing.length > 0 || cacheHitRate !== null || trafficMultiplier !== 1;

  // Dragging a slider fires continuously; debounce so one gesture is one query.
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    clearTimeout(debounce.current);

    debounce.current = setTimeout(() => {
      setPending(true);
      fetch(`/api/simulate?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<ScenarioResult>;
        })
        .then((data) => {
          setResult(data);
          setError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        })
        .finally(() => setPending(false));
    }, 180);

    return () => {
      clearTimeout(debounce.current);
      controller.abort();
    };
  }, [scenario, queryString]);

  const reset = () => {
    setRouting({});
    setCacheHitRate(null);
    setTrafficMultiplier(1);
  };

  const saving = result ? -result.deltaUsd : 0;
  const qualityDelta = result ? result.scenarioQuality - result.baselineQuality : 0;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <SlidersHorizontal
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-text-subtle"
            />
            What-if simulator
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Re-prices the traffic in view against the scenario below
          </p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-150 hover:border-border-strong hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
            Reset
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {/* ── Controls ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
              Re-route traffic
            </legend>
            <div className="space-y-2.5">
              {ENDPOINT_IDS.map((endpoint) => {
                const current = routing[endpoint];
                return (
                  <div key={endpoint} className="flex flex-wrap items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-text-muted">
                      {endpoint}
                    </span>
                    <select
                      value={current?.model ?? NONE}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRouting((prev) => {
                          const next = { ...prev };
                          if (value === NONE) delete next[endpoint];
                          else
                            next[endpoint] = {
                              model: value as ModelId,
                              share: current?.share ?? 1,
                            };
                          return next;
                        });
                      }}
                      className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <option value={NONE}>unchanged</option>
                      {MODEL_ORDER.map((m) => (
                        <option key={m} value={m}>
                          → {MODELS[m].label}
                        </option>
                      ))}
                    </select>

                    {current && (
                      <label className="flex flex-1 items-center gap-2 text-xs text-text-muted">
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={5}
                          value={Math.round(current.share * 100)}
                          onChange={(e) =>
                            setRouting((prev) => ({
                              ...prev,
                              [endpoint]: {
                                ...prev[endpoint],
                                share: Number(e.target.value) / 100,
                              },
                            }))
                          }
                          className="h-1 flex-1 accent-accent"
                          aria-label={`Share of ${endpoint} traffic to move`}
                        />
                        <span className="w-9 text-right tabular-nums">
                          {Math.round(current.share * 100)}%
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <Slider
            label="Prompt cache hit rate"
            hint={
              cacheHitRate === null
                ? "as observed"
                : `${Math.round(cacheHitRate * 100)}% of input tokens cached`
            }
            value={cacheHitRate === null ? 0 : Math.round(cacheHitRate * 100)}
            min={0}
            max={100}
            step={5}
            disabled={cacheHitRate === null}
            onChange={(v) => setCacheHitRate(v / 100)}
            toggle={{
              checked: cacheHitRate !== null,
              onChange: (on) => setCacheHitRate(on ? 0.5 : null),
              label: "override",
            }}
          />

          <Slider
            label="Traffic volume"
            hint={`${trafficMultiplier.toFixed(1)}× today's volume`}
            value={Math.round(trafficMultiplier * 10)}
            min={5}
            max={100}
            step={5}
            onChange={(v) => setTrafficMultiplier(v / 10)}
          />
        </div>

        {/* ── Projection ───────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          {error ? (
            <p className="text-sm text-danger">Simulation failed: {error}</p>
          ) : !result ? (
            <p className="py-8 text-center text-sm text-text-muted">Calculating…</p>
          ) : (
            <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">
                Projected monthly spend
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatUsd(result.scenarioMonthlyUsd)}
              </p>
              <p className="mt-0.5 text-xs text-text-muted tabular-nums">
                today {formatUsd(result.baselineMonthlyUsd)}
              </p>

              <p
                className={`mt-3 text-sm font-medium tabular-nums ${
                  saving > 0 ? "text-success" : saving < 0 ? "text-danger" : "text-text-muted"
                }`}
              >
                {saving > 0 ? "−" : saving < 0 ? "+" : ""}
                {formatUsd(Math.abs(saving))} / mo
                <span className="ml-1.5 text-xs font-normal text-text-muted">
                  ({result.deltaPct >= 0 ? "+" : ""}
                  {result.deltaPct.toFixed(1)}%)
                </span>
              </p>

              <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
                <Row label="Requests re-routed">
                  {result.movedRequests.toLocaleString()} /{" "}
                  {result.totalRequests.toLocaleString()}
                </Row>
                <Row label="Avg quality">
                  <span
                    className={
                      qualityDelta < -0.001
                        ? "text-warning"
                        : qualityDelta > 0.001
                          ? "text-success"
                          : ""
                    }
                  >
                    {result.scenarioQuality.toFixed(3)}
                    {Math.abs(qualityDelta) > 0.0005 && (
                      <span className="ml-1 opacity-80">
                        ({qualityDelta >= 0 ? "+" : ""}
                        {qualityDelta.toFixed(3)})
                      </span>
                    )}
                  </span>
                </Row>
              </dl>

              {result.movedRequests > 0 && (
                <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                  Cost is re-priced exactly from observed token counts. Quality is
                  projected from each model&apos;s baseline score and is an estimate.
                </p>
              )}

              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
                  Spend by model
                </p>
                <ul className="space-y-1.5">
                  {result.byModel
                    .filter((m) => m.scenarioUsd > 0 || m.baselineUsd > 0)
                    .map((m) => {
                      const max = Math.max(
                        ...result.byModel.map((x) =>
                          Math.max(x.scenarioUsd, x.baselineUsd),
                        ),
                        1,
                      );
                      return (
                        <li key={m.model} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="flex items-center gap-1.5 truncate">
                              <span
                                className="h-2 w-2 shrink-0 rounded-sm"
                                style={{ backgroundColor: MODEL_COLORS[m.model] }}
                                aria-hidden
                              />
                              <span className="truncate text-text-muted">
                                {MODELS[m.model].label}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {formatUsd(m.scenarioUsd)}
                            </span>
                          </div>
                          {/* Ghost bar = today, solid bar = scenario. */}
                          <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full opacity-25"
                              style={{
                                width: `${(m.baselineUsd / max) * 100}%`,
                                backgroundColor: MODEL_COLORS[m.model],
                              }}
                            />
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                              style={{
                                width: `${(m.scenarioUsd / max) * 100}%`,
                                backgroundColor: MODEL_COLORS[m.model],
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  toggle,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  toggle?: { checked: boolean; onChange: (on: boolean) => void; label: string };
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="flex items-center gap-2 text-xs text-text-muted">
          {toggle && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
                className="accent-accent"
              />
              {toggle.label}
            </label>
          )}
          <span className="tabular-nums">{hint}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="h-1 w-full accent-accent disabled:opacity-40"
      />
    </div>
  );
}
