import { cn } from "@/lib/cn";
import { Card } from "./card";

/**
 * A loading placeholder.
 *
 * A directional sweep rather than animate-pulse: pulsing strobes a whole block's
 * opacity, which reads as "broken" more than "loading" and is the worse choice
 * for photosensitivity. The sweep also has a direction, so several of these on
 * screen at once look like one system rather than a flicker.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        "animate-shimmer rounded bg-surface-2 bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--surface-3)_50%,var(--surface-2)_100%)]",
        className,
      )}
    />
  );
}

/** Card shell with a title block and n body lines. */
export function PanelSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <Card className={className}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </Card>
  );
}

/**
 * Chart placeholder.
 *
 * `height` must match the real chart's, or the page jumps when data lands —
 * which is the entire point of rendering a skeleton rather than nothing.
 */
export function ChartSkeleton({
  height,
  className,
}: {
  height: number;
  className?: string;
}) {
  // Varied bar heights so it reads as a chart rather than a grey slab.
  const bars = [62, 84, 48, 92, 70, 55, 88, 64, 78, 50, 86, 60];
  return (
    <Card className={className}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <div
        className="mt-5 flex items-end gap-2"
        style={{ height }}
        aria-hidden
      >
        {bars.map((h, i) => (
          <div key={i} className="flex h-full flex-1 items-end">
            <Skeleton className="w-full" style={{ height: `${h}%` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-2 h-3 w-64" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </Card>
  );
}
