import type { TimeBucket } from "./aggregate";

/**
 * Fold a bucket series down to exactly `n` points for a sparkline.
 *
 * The raw series length varies by window (1h → 30 buckets, 24h → 48, 7d → 56),
 * and a sparkline wants a fixed point count so its shape reads the same
 * whichever window is selected. Buckets are grouped into `n` contiguous spans
 * and summed — summed, not averaged, because cost is additive and the
 * sparkline should preserve the total under the curve.
 *
 * Shorter-than-n inputs are returned as-is rather than padded: inventing zeros
 * would draw a trend that isn't there.
 */
export function toSparkline(buckets: TimeBucket[], n = 12): number[] {
  if (n <= 0 || buckets.length === 0) return [];
  if (buckets.length <= n) return buckets.map((b) => b.costUsd);

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Fractional boundaries so the remainder is spread across the groups
    // instead of piling into the last one.
    const start = Math.floor((i * buckets.length) / n);
    const end = Math.floor(((i + 1) * buckets.length) / n);
    let sum = 0;
    for (let j = start; j < end; j++) sum += buckets[j].costUsd;
    out.push(sum);
  }
  return out;
}

/**
 * Same fold, over request counts rather than cost.
 */
export function toSparklineRequests(buckets: TimeBucket[], n = 12): number[] {
  return toSparkline(
    buckets.map((b) => ({ ...b, costUsd: b.requests })),
    n,
  );
}
