import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  deltaPct?: number | null;
  showComparison?: boolean;
  /** When true, an increase is *bad* (cost, errors) — colour flips. */
  invertDelta?: boolean;
  icon?: LucideIcon;
  primary?: boolean;
  loading?: boolean;
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
  showComparison = false,
  invertDelta = false,
  icon: Icon,
  primary = false,
  loading = false,
}: StatTileProps) {
  return (
    <div className={cn("min-w-0 bg-surface px-3.5 py-3.5 sm:px-5 sm:py-4", primary && "border-l-2 border-accent bg-accent-soft")}>
      <span className="inline-flex items-center gap-2 text-xs font-medium text-text-muted sm:text-sm">
        {Icon && <Icon size={15} strokeWidth={1.75} aria-hidden className={cn("shrink-0 text-text-subtle", primary && "text-accent")} />}
        {label}
      </span>
      <div
        className={cn(
          "mt-1.5 wrap-anywhere text-[1.5rem] leading-tight font-semibold tracking-tight tabular-nums sm:text-[1.85rem]",
          primary && "text-accent",
        )}
      >
        {loading ? (
          <span
            className="inline-block h-7 w-3/4 animate-pulse rounded bg-surface-2"
          />
        ) : (
          value
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted">
        {showComparison && !loading
          ? deltaPct == null ? <span>No previous baseline</span> : (
            <><DeltaBadge pct={deltaPct} invert={invertDelta} /><span>vs previous period</span></>
          )
          : sub}
      </div>
    </div>
  );
}
