"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeBucket } from "@/lib/aggregate";
import type { WindowKey } from "@/lib/api-types";
import { MODELS } from "@/lib/models";
import { CHART, MODEL_COLORS, MODEL_ORDER } from "@/lib/palette";
import { formatEventTime, formatUsdAxis } from "@/lib/format";
import { ChartTooltip } from "./chart-tooltip";

function timeTick(windowKey: WindowKey) {
  return (t: number) => {
    const d = new Date(t);
    if (windowKey === "7d") {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };
}

export function CostOverTime({
  data,
  windowKey,
  selectedAt,
  anomalyTimes,
}: {
  data: TimeBucket[];
  windowKey: WindowKey;
  selectedAt?: number;
  anomalyTimes: number[];
}) {
  const fmtTick = timeTick(windowKey);
  const peak = Math.max(0, ...data.map((bucket) => bucket.costUsd));
  const markers = data.filter(({ t }) => anomalyTimes.includes(t) || t === selectedAt);
  const ticks = windowKey === "7d" ? data.filter((_, i) => i % 8 === 0).map(({ t }) => t) : undefined;

  return (
    <div className="h-[300px] xl:h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            ticks={ticks}
            tickFormatter={fmtTick}
            stroke={CHART.axis}
            tick={{ fontSize: 11, fill: CHART.axis }}
            tickLine={false}
            minTickGap={36}
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
            content={({ active, payload }) => {
              const bucket = payload?.[0]?.payload as TimeBucket | undefined;
              if (!bucket) return null;
              return (
                <ChartTooltip
                  active={active}
                  title={formatEventTime(bucket.t)}
                  rows={MODEL_ORDER.map((model) => ({
                    name: MODELS[model].label,
                    color: MODEL_COLORS[model],
                    value: bucket.costByModel[model],
                  }))}
                  total={bucket.costUsd}
                />
              );
            }}
          />
          <Area
            type="linear"
            dataKey="costUsd"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="var(--accent)"
            fillOpacity={0.08}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
            isAnimationActive={false}
          />
          {selectedAt !== undefined && (
            <ReferenceLine x={selectedAt} stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          {markers.map(({ t, costUsd }) => (
            <ReferenceDot key={t} x={t} y={costUsd} r={t === selectedAt ? 5 : 3.5} fill="var(--warning)" stroke={CHART.surface} strokeWidth={1.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
