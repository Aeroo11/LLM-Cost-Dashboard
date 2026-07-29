"use client";

import {
  CartesianGrid,
  Cell,
  LabelList,
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
import { formatUsd, formatUsdAxis } from "@/lib/format";

/**
 * Recharts hands the label content the bubble's *bounding box* plus the plot's
 * own box. Both are optional in its typings, so read them structurally rather
 * than reaching into a type the package doesn't export from its root.
 */
interface BubbleLabelProps {
  x?: string | number;
  y?: string | number;
  width?: string | number;
  height?: string | number;
  value?: unknown;
  parentViewBox?: { x?: number; width?: number };
}

/**
 * Direct labels on every bubble. These are load-bearing, not decoration: under
 * the all-pairs rule that governs a scatter, gpt-4o-mini's yellow and
 * claude-sonnet-5's green measure ΔE 6.9 for protanopia — inside the band that
 * is only legal with a secondary encoding channel. The label is that channel,
 * and it also means the tooltip is not the sole way to read the chart.
 *
 * With four points, side-anchor rather than nudging labels apart vertically — a
 * displaced label detaches from its mark and reads as noise. Labels sit to the
 * right by default and flip left only when the right edge would clip them, so a
 * label never leaves the plot. A label that runs off the canvas is worse than
 * no label.
 */
function BubbleLabel({
  x,
  y,
  width,
  height,
  value,
  parentViewBox,
}: BubbleLabelProps) {
  const text = String(value ?? "");
  const w = Number(width);
  const cx = Number(x) + w / 2;
  const cy = Number(y) + Number(height) / 2;
  const r = w / 2;

  const plotX = parentViewBox?.x ?? 0;
  const plotW = parentViewBox?.width ?? 0;
  // ~5.6px per character at 11px in this face — enough to decide a side.
  const estimated = text.length * 5.6;
  const flip = plotW > 0 && cx + r + 8 + estimated > plotX + plotW;

  return (
    <text
      x={flip ? cx - r - 8 : cx + r + 8}
      y={cy}
      textAnchor={flip ? "end" : "start"}
      dominantBaseline="middle"
      // A text token, never the series colour — identity comes from the
      // coloured bubble beside the label, not from tinting the label itself.
      fill={CHART.ink}
      fontSize={11}
      fontWeight={500}
    >
      {text}
    </text>
  );
}

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

  // Clamped to the data rather than pinned at 0.75: a model whose average
  // quality dipped below the hardcoded floor used to vanish off-axis with no
  // indication that a series was missing.
  const xPeak = Math.max(0, ...rows.map((r) => r.x));
  const minQuality = rows.length > 0 ? Math.min(...rows.map((r) => r.y)) : 0.75;
  const yDomain: [number, number] = [
    Math.max(0, Math.min(0.75, minQuality - 0.02)),
    1,
  ];

  return (
    // 288, not 260: the x-axis label sits below the plot, and a container sized
    // to the plot alone crops it.
    <ResponsiveContainer width="100%" height={288}>
      <ScatterChart margin={{ top: 12, right: 72, left: 4, bottom: 28 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis
          type="number"
          dataKey="x"
          name="cost/req"
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          tickFormatter={(v: number) => formatUsdAxis(v, xPeak)}
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
          domain={yDomain}
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
        {/* Widened from [120, 900]: the smallest bubble was a ~12px pinpoint,
            well under a comfortable hit target. */}
        <ZAxis type="number" dataKey="z" range={[280, 1100]} />
        <Tooltip
          cursor={{ strokeOpacity: 0.2 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof rows)[number];
            return (
              <div className="rounded-control border border-border bg-surface-2 px-3 py-2 text-xs shadow-pop">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <span
                    className="h-0.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: MODEL_COLORS[p.model] }}
                  />
                  {p.label}
                </p>
                <p className="text-text-muted tabular-nums">
                  {formatUsd(p.x)}/req · quality {p.y.toFixed(2)} · {formatUsd(p.z)} total
                </p>
              </div>
            );
          }}
        />
        <Scatter data={rows} isAnimationActive={false}>
          {/* TODO: migrate to the `shape` prop before Recharts 4 deprecates Cell. */}
          {rows.map((r) => (
            <Cell
              key={r.model}
              fill={MODEL_COLORS[r.model]}
              fillOpacity={0.85}
              // A ring in the *surface* colour, not the series colour: it is what
              // keeps overlapping bubbles legible where they cross.
              stroke={CHART.surface}
              strokeWidth={2}
            />
          ))}
          {/* Recharts types `content` against a union covering polar charts too,
              so narrow to the cartesian shape at the boundary. */}
          <LabelList
            dataKey="label"
            content={(props) => <BubbleLabel {...(props as BubbleLabelProps)} />}
          />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
