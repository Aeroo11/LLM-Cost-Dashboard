"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EndpointModelCell } from "@/lib/db/queries";
import type { Endpoint, ModelId } from "@/lib/types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ENDPOINT_IDS } from "@/lib/db/filters";
import { formatUsd } from "@/lib/format";

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
  const dimmed = (selected?.length ?? 0) > 0;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          tickFormatter={(v: number) => formatUsd(v)}
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
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
            return (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-xl">
                <p className="mb-1.5 font-medium">
                  {String(label)} · {formatUsd(total)}
                </p>
                {[...payload]
                  .filter((p) => Number(p.value ?? 0) > 0)
                  .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
                  .map((p) => (
                    <p key={String(p.dataKey)} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-text-muted">
                        {MODELS[p.dataKey as ModelId].label}
                      </span>
                      <span className="ml-auto tabular-nums">
                        {formatUsd(Number(p.value))}
                      </span>
                      <span className="text-text-muted tabular-nums">
                        {total > 0
                          ? `${((Number(p.value) / total) * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    </p>
                  ))}
              </div>
            );
          }}
        />
        {MODEL_ORDER.map((m) => (
          <Bar
            key={m}
            dataKey={m}
            stackId="cost"
            fill={MODEL_COLORS[m]}
            isAnimationActive={false}
            cursor={onSelect ? "pointer" : undefined}
            // Selected endpoints stay solid; the rest recede.
            fillOpacity={
              dimmed ? 0.35 : 0.95
            }
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
