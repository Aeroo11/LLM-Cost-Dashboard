"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeBucket } from "@/lib/aggregate";
import type { WindowKey } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { ChartTooltip } from "./chart-tooltip";

function timeTick(windowKey: WindowKey) {
  return (t: number) => {
    const d = new Date(t);
    if (windowKey === "7d") {
      return d.toLocaleDateString("en-US", { weekday: "short" });
    }
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };
}

export function CostOverTime({
  data,
  windowKey,
}: {
  data: TimeBucket[];
  windowKey: WindowKey;
}) {
  const rows = data.map((b) => ({ t: b.t, ...b.costByModel }));
  const fmtTick = timeTick(windowKey);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          {MODEL_ORDER.map((m) => (
            <linearGradient key={m} id={`grad-${m}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={MODEL_COLORS[m]} stopOpacity={0.55} />
              <stop offset="100%" stopColor={MODEL_COLORS[m]} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={fmtTick}
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          stroke={CHART.axis}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
        />
        <Tooltip
          cursor={{ stroke: CHART.axis, strokeOpacity: 0.3 }}
          content={({ active, label, payload }) => (
            <ChartTooltip
              active={active}
              title={typeof label === "number" ? fmtTick(label) : undefined}
              rows={MODEL_ORDER.map((m) => ({
                name: MODELS[m].label,
                color: MODEL_COLORS[m],
                value: Number(payload?.find((p) => p.dataKey === m)?.value ?? 0),
              }))}
              total={(payload ?? []).reduce((s, p) => s + Number(p.value ?? 0), 0)}
            />
          )}
        />
        {MODEL_ORDER.map((m) => (
          <Area
            key={m}
            type="monotone"
            dataKey={m}
            stackId="cost"
            stroke={MODEL_COLORS[m]}
            strokeWidth={1.5}
            fill={`url(#grad-${m})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
