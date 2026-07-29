import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card } from "./card";
import { Sparkline } from "../charts/sparkline";

export interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  deltaPct?: number | null;
  /** When true, an increase is *bad* (cost, errors) — colour flips. */
  invertDelta?: boolean;
  icon?: LucideIcon;
  /** Folded series, oldest → newest. Drawn under the value. */
  trend?: number[];
  /** "hero" is the one number the dashboard leads with. Exactly one per view. */
  size?: "hero" | "tile";
  loading?: boolean;
  className?: string;
}

function DeltaBadge({ pct, invert }: { pct: number; invert: boolean }) {
  const flat = Math.abs(pct) < 0.05;
  const isUp = pct >= 0;
  const good = invert ? !isUp : isUp;
  const color = flat ? "text-text-muted" : good ? "text-success" : "text-danger";
  const Arrow = flat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", color)}>
      <Arrow size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      {formatDelta(pct)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  deltaPct,
  invertDelta = false,
  icon: Icon,
  trend,
  size = "tile",
  loading = false,
  className,
}: StatTileProps) {
  const hero = size === "hero";

  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-eyebrow font-medium uppercase text-text-muted">
          {Icon && (
            <Icon
              size={14}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-text-subtle"
            />
          )}
          {label}
        </span>
        {deltaPct != null && !loading && (
          <DeltaBadge pct={deltaPct} invert={invertDelta} />
        )}
      </div>

      {/* No tabular-nums on the value: equal-width digits make a number like
          $1,284 look loose at display sizes. Tabular figures belong in columns
          that must align vertically — the requests table and axis ticks. */}
      <div
        className={cn(
          "mt-3 font-semibold",
          hero ? "text-hero" : "text-stat",
          loading && "w-full",
        )}
      >
        {loading ? (
          <span
            className={cn(
              "inline-block w-3/4 animate-pulse rounded bg-surface-2",
              hero ? "h-12" : "h-7",
            )}
          />
        ) : (
          value
        )}
      </div>

      {sub && <p className="mt-1.5 text-xs text-text-muted">{sub}</p>}

      {trend && trend.length > 1 && !loading && (
        // The hero spans two rows, so its trend grows into the space rather
        // than sitting pinned to the bottom with a void above it.
        <div className={cn("w-full", hero ? "mt-6 min-h-0 flex-1" : "mt-auto pt-4 h-8")}>
          <Sparkline points={trend} filled={hero} className="h-full w-full" />
        </div>
      )}
    </Card>
  );
}
