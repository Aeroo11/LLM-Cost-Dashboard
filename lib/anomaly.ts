/**
 * Robust anomaly scoring.
 *
 * The obvious approach — flag anything more than 3 standard deviations from the
 * mean — fails badly on this data. Both the mean and the standard deviation are
 * dragged around by the very spikes we are trying to detect, so one large
 * incident inflates the threshold enough to hide the next one, and a sustained
 * outage quietly becomes the new normal.
 *
 * So the baseline is a rolling *median* and the spread is the median absolute
 * deviation. Both have a breakdown point of 50%: up to half the history can be
 * garbage before the estimate moves. The score is the Iglewicz–Hoaglin modified
 * z-score, whose conventional flagging threshold is 3.5.
 *
 * This module is pure and dependency-free; `lib/db/anomalies.ts` implements the
 * same arithmetic in SQL and the tests reconcile the two.
 */

/** Scale factor making MAD a consistent estimator of σ for normal data. */
export const MAD_TO_SIGMA = 1.4826;

/** 0.6745 is Φ⁻¹(0.75) — the constant in the modified z-score. */
const MODIFIED_Z_CONST = 0.6745;

/** Conventional flagging threshold for the modified z-score. */
export const DEFAULT_THRESHOLD = 3.5;

/**
 * Minimum trailing points before a verdict is offered. Scoring against three
 * data points produces confident nonsense.
 */
export const MIN_HISTORY = 8;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation from the median. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Modified z-score of `value` against `history`.
 *
 * `noiseFloor` is a lower bound on the spread estimate, and it is not optional
 * in practice. MAD collapses to zero whenever more than half the history takes
 * the same value — and a healthy service has an error rate of *exactly* zero
 * for hours at a time. Without a floor, the one metric most worth alerting on
 * is the one that can never fire. The floor also caps sensitivity from the
 * other side: a metric that normally varies by microseconds should not report a
 * finding because it varied by two microseconds this time.
 *
 * Returns null when there is not enough history to judge, or when even the
 * floor leaves the spread at zero (no traffic at all in the window).
 */
export function modifiedZ(
  value: number,
  history: number[],
  noiseFloor = 0,
): number | null {
  if (history.length < MIN_HISTORY) return null;
  const m = median(history);
  const d = Math.max(mad(history), noiseFloor);
  if (d <= 0) return null;
  return (MODIFIED_Z_CONST * (value - m)) / d;
}

export interface ScoredPoint {
  index: number;
  value: number;
  /** Rolling median of the trailing window — what was expected. */
  baseline: number;
  /** Signed modified z-score; positive is above baseline. */
  score: number;
}

/**
 * Score every point against the `lookback` points immediately preceding it.
 *
 * The current point is deliberately excluded from its own baseline: including
 * it pulls the median toward the value being tested and blunts exactly the
 * signal we want. Points without `MIN_HISTORY` predecessors are skipped rather
 * than guessed at, which is why the first stretch of any window is never
 * flagged.
 */
export function scoreSeries(
  values: number[],
  lookback: number,
  noiseFloor = 0,
): ScoredPoint[] {
  const out: ScoredPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const history = values.slice(Math.max(0, i - lookback), i);
    const score = modifiedZ(values[i], history, noiseFloor);
    if (score === null) continue;
    out.push({
      index: i,
      value: values[i],
      baseline: median(history),
      score,
    });
  }
  return out;
}
