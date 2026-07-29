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
