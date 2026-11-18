import { CHART } from "@/lib/palette";

/**
 * A trend line for a stat tile.
 *
 * Hand-rolled SVG rather than Recharts: mounting four ResponsiveContainers with
 * their own ResizeObservers to draw twelve points costs a measurement pass and
 * a layout flash for something a polyline does exactly. It is also decorative
 * in the strict sense — the value it accompanies is already printed beside it,
 * so it carries aria-hidden and no tooltip.
 *
 * The series is drawn in a de-emphasised ink with the final segment and its end
 * dot in the accent, so the eye lands on "where it is now" rather than on the
 * whole history.
 */
export function Sparkline({
  points,
  filled = false,
  className = "",
}: {
  points: number[];
  /** Wash under the line. Worth it only at hero size, where a bare 1.5px line
   *  reads as sparse across a tall card. */
  filled?: boolean;
  className?: string;
}) {
  if (points.length < 2) return null;

  const W = 100;
  const H = 28;
  const PAD = 3; // room for the end dot and its ring

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;

  const at = (i: number): [number, number] => [
    (i / (points.length - 1)) * W,
    H - PAD - ((points[i] - min) / span) * (H - PAD * 2),
  ];

  const path = points.map((_, i) => at(i).join(",")).join(" ");
  const [lastX, lastY] = at(points.length - 1);
  const [prevX, prevY] = at(points.length - 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // The tile controls the box; the line stretches to fill it.
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {filled && (
        // A ~10% wash, not a saturated block: the line carries the value, the
        // fill only gives it presence.
        <polygon
          points={`0,${H} ${path} ${W},${H}`}
          fill={CHART.axis}
          fillOpacity={0.1}
        />
      )}
      <polyline
        points={path}
        fill="none"
        stroke={CHART.axis}
        strokeOpacity={0.45}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={`${prevX},${prevY} ${lastX},${lastY}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The end dot is a round line-cap on a zero-length segment, not a
          <circle>: preserveAspectRatio="none" stretches the viewBox, which
          would render a circle as an ellipse. A non-scaling stroke is measured
          in screen space, so its cap stays round at any tile width. The wider
          surface-coloured cap underneath is the 2px ring. */}
      <path
        d={`M ${lastX} ${lastY} L ${lastX} ${lastY}`}
        stroke={CHART.surface}
        strokeWidth={9}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M ${lastX} ${lastY} L ${lastX} ${lastY}`}
        stroke="var(--accent)"
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
