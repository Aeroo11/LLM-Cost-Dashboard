"use client";

import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { avgQuality, type GroupStats } from "@/lib/aggregate";
import type { ModelId } from "@/lib/types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS } from "@/lib/palette";
import { formatUsd } from "@/lib/format";

export function CostVsQuality({
  byModel,
}: {
  byModel: Record<ModelId, GroupStats>;
}) {
  const rows = (Object.keys(byModel) as ModelId[])
    .map((m) => {
      const g = byModel[m];
      const q = avgQuality(g);
      return {
        model: m,
        label: MODELS[m].label,
        x: g.requests > 0 ? g.costUsd / g.requests : 0,
        y: q ?? 0,
        z: g.costUsd,
      };
    })
    .filter((r) => r.y > 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 16 }}>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="cost/req"
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          tickFormatter={(v: number) => formatUsd(v)}
          label={{
            value: "Avg cost / request →",
            position: "insideBottom",
            offset: -8,
            fill: CHART.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="quality"
          domain={[0.75, 1]}
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          tickFormatter={(v: number) => v.toFixed(2)}
          label={{
            value: "Quality ↑",
            angle: -90,
            position: "insideLeft",
            fill: CHART.axis,
            fontSize: 11,
          }}
        />
        <ZAxis type="number" dataKey="z" range={[120, 900]} />
        <Tooltip
          cursor={{ strokeOpacity: 0.2 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof rows)[number];
            return (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-xl">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: MODEL_COLORS[p.model] }}
                  />
                  {p.label}
                </p>
                <p className="text-text-muted">
                  {formatUsd(p.x)}/req · quality {p.y.toFixed(2)} · {formatUsd(p.z)} total
                </p>
              </div>
            );
          }}
        />
        <Scatter data={rows} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell
              key={r.model}
              fill={MODEL_COLORS[r.model]}
              fillOpacity={0.75}
              stroke={MODEL_COLORS[r.model]}
              strokeWidth={1.5}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
