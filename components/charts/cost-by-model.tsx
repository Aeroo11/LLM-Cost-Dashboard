"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { GroupStats } from "@/lib/aggregate";
import type { ModelId } from "@/lib/types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS } from "@/lib/palette";
import { formatUsd } from "@/lib/format";

export function CostByModel({
  byModel,
  total,
}: {
  byModel: Record<ModelId, GroupStats>;
  total: number;
}) {
  const rows = (Object.keys(byModel) as ModelId[])
    .map((m) => ({
      model: m,
      label: MODELS[m].label,
      cost: byModel[m].costUsd,
      share: total > 0 ? byModel[m].costUsd / total : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 72, left: 8, bottom: 4 }}
        barCategoryGap={12}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          tick={{ fontSize: 12, fill: CHART.ink }}
          tickLine={false}
          axisLine={false}
        />
        <Bar dataKey="cost" radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.model} fill={MODEL_COLORS[r.model]} />
          ))}
          <LabelList
            dataKey="cost"
            position="right"
            content={({ x, y, width, height, value }) => {
              const row = rows.find((r) => Math.abs(r.cost - Number(value)) < 1e-9);
              return (
                <text
                  x={Number(x) + Number(width) + 8}
                  y={Number(y) + Number(height) / 2}
                  fill={CHART.ink}
                  fontSize={12}
                  fontWeight={600}
                  dominantBaseline="middle"
                >
                  {formatUsd(Number(value))}
                  <tspan fill={CHART.axis} fontWeight={400}>
                    {row ? `  ${(row.share * 100).toFixed(0)}%` : ""}
                  </tspan>
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
