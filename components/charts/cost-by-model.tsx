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
import { formatUsdLabel } from "@/lib/format";

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

  // One format for every label in the chart. formatUsd picks its precision per
  // value, which printed "$24.76" beside "$0.2942" in the same column.
  const costs = rows.map((r) => r.cost).filter((c) => c > 0);
  const peak = Math.max(0, ...costs);
  const floor = costs.length > 0 ? Math.min(...costs) : 0;

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
        {/* Radius on the data-end only — bars grow from x=0, so the left edge is
            the baseline and must stay square. maxBarSize caps the mark at 24px;
            without it the four rows filled their bands at ~50px and read loud. */}
        <Bar
          dataKey="cost"
          radius={[0, 4, 4, 0]}
          maxBarSize={24}
          activeBar
          isAnimationActive={false}
        >
          {/* TODO: migrate to the `shape` prop before Recharts 4 deprecates Cell. */}
          {rows.map((r) => (
            <Cell key={r.model} fill={MODEL_COLORS[r.model]} />
          ))}
          <LabelList
            dataKey="cost"
            position="right"
            content={({ x, y, width, height, value, index }) => {
              // Look the row up by index, not by matching its value: two models
              // with identical cost would otherwise both resolve to the first,
              // pinning the wrong share percentage to a bar.
              const row = rows[Number(index)];
              return (
                <text
                  x={Number(x) + Number(width) + 8}
                  y={Number(y) + Number(height) / 2}
                  fill={CHART.ink}
                  fontSize={12}
                  fontWeight={600}
                  dominantBaseline="middle"
                >
                  {formatUsdLabel(Number(value), floor, peak)}
                  {/* dx, not literal spaces — SVG collapses whitespace, so the
                      two-space gutter this replaces rendered as one. */}
                  <tspan dx={6} fill={CHART.axis} fontWeight={400}>
                    {row ? `${(row.share * 100).toFixed(0)}%` : ""}
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
