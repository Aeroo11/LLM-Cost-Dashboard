/** Presentation helpers — pure formatting, no domain logic. */

const int = new Intl.NumberFormat("en-US");

/** Adaptive USD: thousands get commas, sub-dollar values keep precision. */
export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${int.format(Math.round(n))}`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(2)}`;
}

/**
 * USD for an axis tick.
 *
 * Unlike formatUsd, every tick on one axis must share a format: formatUsd picks
 * its precision per value, so a single axis could read "$0.4500, $0.9000, $1.35,
 * $1.80". The decimal count is chosen once from the axis maximum and applied to
 * all of them.
 */
export function formatUsdAxis(n: number, axisMax: number): string {
  const max = Math.abs(axisMax);
  if (max >= 1000) return `$${int.format(Math.round(n))}`;
  const digits = max >= 100 ? 0 : max >= 10 ? 1 : max >= 1 ? 2 : max >= 0.1 ? 3 : 4;
  return `$${n.toFixed(digits)}`;
}

/**
 * USD for a set of direct labels that must share one format.
 *
 * Like formatUsdAxis, every label in a chart gets the same shape — but a label
 * has to stay *readable*, so the precision is driven by the smallest value in
 * the set rather than the largest. Sharing the axis rule here would round a
 * $0.29 bar to "$0.3" just because a $24.76 bar sits above it.
 */
export function formatUsdLabel(n: number, smallest: number, largest: number): string {
  if (largest >= 1000) return `$${int.format(Math.round(n))}`;
  const min = Math.abs(smallest);
  // Enough decimals for two significant digits on the smallest value, capped so
  // a large value never grows a tail of noise.
  const needed = min >= 1 ? 2 : min >= 0.1 ? 2 : min >= 0.01 ? 3 : 4;
  const digits = largest >= 10 ? Math.min(needed, 2) : needed;
  return `$${n.toFixed(digits)}`;
}

/** Ratio (0..1) → "3.1%". */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Signed delta percentage → "+4.2%" / "-1.8%". */
export function formatDelta(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Compact token counts → "13.4M", "2.5k". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return int.format(Math.round(n));
}

/** Latency → "976 ms" or "4.82 s". */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatInt(n: number): string {
  return int.format(Math.round(n));
}

export function formatEventTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
