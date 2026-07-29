import { formatDelta } from "@/lib/format";
import { Card } from "./ui/card";

export interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  deltaPct?: number | null;
  /** When true, an increase is *bad* (cost, errors) — colour flips. */
  invertDelta?: boolean;
  accent?: boolean;
  loading?: boolean;
}

function DeltaBadge({ pct, invert }: { pct: number; invert: boolean }) {
  const flat = Math.abs(pct) < 0.05;
  const isUp = pct >= 0;
  const good = invert ? !isUp : isUp;
  const color = flat
    ? "text-text-muted"
    : good
      ? "text-success"
      : "text-danger";
  const arrow = flat ? "→" : isUp ? "▲" : "▼";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <span aria-hidden>{arrow}</span>
      {formatDelta(pct)}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  deltaPct,
  invertDelta = false,
  accent = false,
  loading = false,
}: KpiCardProps) {
  return (
    <Card className={accent ? "ring-1 ring-accent/40" : undefined}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {label}
        </span>
        {deltaPct != null && !loading && (
          <DeltaBadge pct={deltaPct} invert={invertDelta} />
        )}
      </div>

      <div className="mt-3 text-2xl font-semibold tabular-nums">
        {loading ? (
          <span className="inline-block h-7 w-24 animate-pulse rounded bg-surface-2" />
        ) : (
          value
        )}
      </div>

      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </Card>
  );
}
