"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import type { EndpointModelCell } from "@/lib/db/queries";
import type { Endpoint, ModelId } from "@/lib/types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ENDPOINT_IDS } from "@/lib/db/filters";
import { formatUsd, formatUsdAxis } from "@/lib/format";
import { ChartTooltip } from "./chart-tooltip";

type Row = { endpoint: Endpoint; total: number } & Partial<Record<ModelId, number>>;

/**
 * Cost per endpoint, stacked by the model that served it.
 *
 * This is the diagnostic view: a cheap, high-volume workload carrying a wide
 * band of an expensive model is over-provisioned routing, visible at a glance.
 * Clicking a bar filters the rest of the dashboard to that endpoint.
 */
export function CostByEndpoint({
  cells,
  onSelect,
  selected,
}: {
  cells: EndpointModelCell[];
  onSelect?: (endpoint: Endpoint) => void;
  selected?: Endpoint[];
}) {
  const byEndpoint = new Map<Endpoint, Row>(
    ENDPOINT_IDS.map((e) => [e, { endpoint: e, total: 0 }]),
  );
  for (const c of cells) {
    const row = byEndpoint.get(c.endpoint);
    if (!row) continue;
    row[c.model] = (row[c.model] ?? 0) + c.costUsd;
    row.total += c.costUsd;
  }

  const data = [...byEndpoint.values()].sort((a, b) => b.total - a.total);
  const peak = Math.max(0, ...data.map((r) => r.total));
  const selectedSet = new Set(selected ?? []);
  const dimmed = selectedSet.size > 0;

  /** The last model with non-zero cost in a row owns that row's data-end. */
  const lastModelOf = (row: Row): ModelId | undefined =>
    [...MODEL_ORDER].reverse().find((m) => (row[m] ?? 0) > 0);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
        maxBarSize={24}
      >
        <CartesianGrid stroke={CHART.grid} horizontal={false} />
        <XAxis
          type="number"
          stroke={CHART.axis}
          tick={{
            fontSize: 11,
            fill: CHART.axis,
            style: { fontVariantNumeric: "tabular-nums" },
          }}
          tickLine={false}
          axisLine={false}
          tickCount={5}
          tickFormatter={(v: number) => formatUsdAxis(v, peak)}
        />
        <YAxis
          type="category"
          dataKey="endpoint"
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          width={70}
        />
        <Tooltip
          cursor={{ fill: "var(--accent-soft)" }}
          content={({ active, payload, label }) => {
            const total = (payload ?? []).reduce((s, p) => s + Number(p.value ?? 0), 0);
            return (
              <ChartTooltip
                active={active}
                title={`${String(label)} · ${formatUsd(total)}`}
                rows={[...(payload ?? [])]
                  .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
                  .map((p) => ({
                    name: MODELS[p.dataKey as ModelId].label,
                    color: MODEL_COLORS[p.dataKey as ModelId],
                    value: Number(p.value ?? 0),
                    share: total > 0 ? Number(p.value ?? 0) / total : 0,
                  }))}
              />
            );
          }}
        />
        {/* Click-to-filter is mouse-only here by design. The endpoint chips in
            FilterBar already give keyboard users the identical action, and one
            filter row above everything it scopes beats a bespoke roving-tabindex
            layer inside a chart. */}
        {MODEL_ORDER.map((m) => (
          <Bar
            key={m}
            dataKey={m}
            stackId="cost"
            fill={MODEL_COLORS[m]}
            isAnimationActive={false}
            cursor={onSelect ? "pointer" : undefined}
            // Bare `activeBar` (not an object) so the hovered bar is routed back
            // through this same shape and keeps its per-row radius.
            activeBar
            // fillOpacity used to be a Bar-level prop computed from a chart-wide
            // boolean, so selecting one endpoint dimmed *every* bar including the
            // selected one — the expression carried no per-row information at all.
            // `shape` sees the row, and is also the only place a stacked bar's
            // data-end radius can be decided (it belongs to whichever model is
            // last non-zero in that row).
            //
            // Note the un-selected rows are usually gone rather than dimmed:
            // queryEndpointMatrix applies the endpoint filter, so drilling in
            // drops the other rows from the payload entirely. The dim state is
            // what you see on the held stale frame while the new one loads.
            // Keeping every endpoint visible after a drill-in would mean not
            // passing filters.endpoints to that query — a backend change.
            shape={(p: BarShapeProps) => {
              const row = p.payload as Row;
              const on = !dimmed || selectedSet.has(row.endpoint);
              return (
                <Rectangle
                  x={p.x}
                  y={p.y}
                  width={p.width}
                  height={p.height}
                  fill={p.fill}
                  fillOpacity={p.isActive ? 1 : on ? 0.95 : 0.3}
                  radius={lastModelOf(row) === m ? [0, 4, 4, 0] : 0}
                  // 2px surface gap between stack segments. Recharts has no
                  // barGap *within* a stack; a surface-coloured stroke is the
                  // mechanism.
                  stroke={CHART.surface}
                  strokeWidth={2}
                />
              );
            }}
            onClick={(entry: unknown) => {
              const row = entry as { payload?: Row } | undefined;
              if (row?.payload) onSelect?.(row.payload.endpoint);
            }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
