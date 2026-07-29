import { cn } from "@/lib/cn";

export interface MeterSegment {
  /** Share of the track, 0..1. */
  value: number;
  /** Any CSS colour — a token var() or a literal hex from lib/palette. */
  color: string;
  label?: string;
}

/**
 * A proportional track.
 *
 * Segments are laid out with a 2px surface gap between them rather than a
 * border around each: the gap is what separates touching marks, and a stroke
 * would add ink that isn't data.
 */
export function Meter({
  segments,
  className,
  size = "md",
}: {
  segments: MeterSegment[];
  className?: string;
  size?: "sm" | "md";
}) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-surface-2",
        size === "sm" ? "h-1.5" : "h-2.5",
        className,
      )}
    >
      {shown.map((s, i) => (
        <div
          key={s.label ?? i}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${s.value * 100}%`,
            backgroundColor: s.color,
            // Surface gap between neighbours, never before the first.
            marginLeft: i === 0 ? undefined : 2,
          }}
          title={s.label}
        />
      ))}
    </div>
  );
}
