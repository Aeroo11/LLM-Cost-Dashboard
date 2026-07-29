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
import { formatUsdAxis } from "@/lib/format";
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

  // Every tick on one axis shares a format, chosen from the tallest stack.
  const peak = Math.max(
    0,
    ...data.map((b) => Object.values(b.costByModel).reduce((s, v) => s + v, 0)),
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
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
          tick={{
            fontSize: 11,
            fill: CHART.axis,
            style: { fontVariantNumeric: "tabular-nums" },
          }}
          tickLine={false}
          axisLine={false}
          width={52}
          // Integer dollars collapsed every tick to "$0" on the 1h window, where
          // buckets are two minutes wide.
          tickFormatter={(v: number) => formatUsdAxis(v, peak)}
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
            fill={MODEL_COLORS[m]}
            fillOpacity={0.9}
            // Surface does the separating, not a coloured outline: a 2px rule in
            // the surface colour along each band's edge. The gradient this
            // replaces made every band's base read as a different series than
            // its top, and a coloured stroke around a mark is ink that is not data.
            stroke={CHART.surface}
            strokeWidth={2}
            strokeLinejoin="round"
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
