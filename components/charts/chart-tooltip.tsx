import { formatUsd } from "@/lib/format";

interface TooltipRow {
  name: string;
  value: number;
  color: string;
}

/** Shared dark tooltip: coloured dot + label in ink + right-aligned USD value. */
export function ChartTooltip({
  active,
  title,
  rows,
  total,
}: {
  active?: boolean;
  title?: string;
  rows?: TooltipRow[];
  total?: number;
}) {
  if (!active || !rows || rows.length === 0) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-xl">
      {title && <p className="mb-1.5 text-xs font-medium text-text-muted">{title}</p>}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: r.color }} />
              <span className="text-text">{r.name}</span>
            </span>
            <span className="font-medium tabular-nums text-text">{formatUsd(r.value)}</span>
          </li>
        ))}
      </ul>
      {total != null && (
        <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5 text-xs">
          <span className="text-text-muted">Total</span>
          <span className="font-semibold tabular-nums">{formatUsd(total)}</span>
        </div>
      )}
    </div>
  );
}
