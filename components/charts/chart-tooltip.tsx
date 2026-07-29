import { formatUsd } from "@/lib/format";

interface TooltipRow {
  name: string;
  value: number;
  color: string;
  /** Optional share of the row's total, 0..1. Rendered after the value. */
  share?: number;
}

/**
 * The one chart tooltip.
 *
 * Values lead and labels follow — you hover to read a number, not a name. The
 * identity swatch is a short line key rather than a filled box: at tooltip
 * density a solid block is data-weight ink doing a label's job.
 */
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
  // Callers pass every series in a fixed order so colours stay stable; drop the
  // ones that contributed nothing to this point rather than listing $0 rows.
  const shown = rows?.filter((r) => r.value > 0) ?? [];
  if (!active || shown.length === 0) return null;

  return (
    <div className="min-w-44 rounded-control border border-border bg-surface-2 px-3 py-2 shadow-pop">
      {title && <p className="mb-1.5 text-xs font-medium text-text-muted">{title}</p>}
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <span className="text-text-muted">{r.name}</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums text-text">
                {formatUsd(r.value)}
              </span>
              {r.share != null && (
                <span className="text-text-subtle tabular-nums">
                  {(r.share * 100).toFixed(0)}%
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {total != null && (
        <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5 text-xs">
          <span className="text-text-muted">Total</span>
          <span className="font-semibold tabular-nums text-text">{formatUsd(total)}</span>
        </div>
      )}
    </div>
  );
}
