import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLD,
  MIN_HISTORY,
  mad,
  median,
  modifiedZ,
  scoreSeries,
} from "./anomaly";

describe("median", () => {
  it("takes the middle value of an odd-length sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values of an even-length sample", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("returns 0 for an empty sample rather than NaN", () => {
    expect(median([])).toBe(0);
  });
});

describe("mad", () => {
  it("is zero for a constant series", () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });

  it("measures spread around the median, not the mean", () => {
    // median 3; deviations 2,1,0,1,2 -> median 1
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
  });

  it("is unmoved by a single extreme outlier", () => {
    const clean = [1, 2, 3, 4, 5];
    const dirty = [1, 2, 3, 4, 5, 10_000];
    // Standard deviation would explode here; MAD barely shifts.
    expect(Math.abs(mad(dirty) - mad(clean))).toBeLessThanOrEqual(1);
  });
});

describe("modifiedZ", () => {
  const flatish = [10, 11, 10, 9, 10, 11, 10, 9, 10, 11];

  it("scores a value at the baseline as ~0", () => {
    expect(modifiedZ(10, flatish)!).toBeCloseTo(0, 10);
  });

  it("flags a clear spike above the conventional threshold", () => {
    expect(modifiedZ(40, flatish)!).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it("signs drops negative", () => {
    expect(modifiedZ(1, flatish)!).toBeLessThan(-DEFAULT_THRESHOLD);
  });

  it("declines to judge without enough history", () => {
    expect(modifiedZ(100, [1, 2, 3])).toBeNull();
    expect(modifiedZ(100, new Array(MIN_HISTORY - 1).fill(1))).toBeNull();
  });

  it("declines to judge a perfectly flat history instead of returning Infinity", () => {
    // MAD is 0 and no floor is supplied; a naive implementation divides by zero
    // and flags everything forever after.
    expect(modifiedZ(999, new Array(20).fill(7))).toBeNull();
  });

  it("still fires on a flat history once a noise floor is supplied", () => {
    // The case that matters in production: a healthy service sits at exactly
    // zero errors, so MAD is zero and an unfloored detector goes permanently
    // blind to error storms. With a floor, the storm is caught.
    const perfectlyHealthy = new Array(20).fill(0);
    expect(modifiedZ(0.6, perfectlyHealthy)).toBeNull();
    expect(modifiedZ(0.6, perfectlyHealthy, 0.005)!).toBeGreaterThan(
      DEFAULT_THRESHOLD,
    );
  });

  it("uses the noise floor to suppress statistically large but trivial moves", () => {
    // Latency wobbling by a microsecond, then moving by three. Statistically
    // enormous; operationally meaningless.
    const history = Array.from({ length: 20 }, (_, i) => 900 + (i % 2) * 0.001);
    expect(Math.abs(modifiedZ(900.005, history)!)).toBeGreaterThan(DEFAULT_THRESHOLD);
    expect(Math.abs(modifiedZ(900.005, history, 25)!)).toBeLessThan(
      DEFAULT_THRESHOLD,
    );
  });

  it("is not blinded by an earlier spike in its own history", () => {
    // The point of using median/MAD: one huge prior incident must not raise the
    // bar so far that the next one goes unnoticed.
    const withPriorSpike = [10, 11, 10, 9, 10, 5_000, 10, 9, 10, 11];
    expect(modifiedZ(40, withPriorSpike)!).toBeGreaterThan(DEFAULT_THRESHOLD);
  });
});

describe("scoreSeries", () => {
  it("skips the leading points that have no baseline to be judged against", () => {
    const scored = scoreSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 24);
    expect(scored[0].index).toBe(MIN_HISTORY);
  });

  /**
   * A deterministic, continuously-varying noise floor around `centre`.
   *
   * Constant or heavily-quantised series are a degenerate case for MAD: as soon
   * as more than half the sample equals the median, every deviation is zero and
   * MAD collapses to zero. `modifiedZ` deliberately declines to score in that
   * situation (covered above), so the series-level tests use a spread that
   * resembles the real cost and latency data.
   */
  const noisy = (n: number, centre: number, spread = 0.06): number[] =>
    Array.from({ length: n }, (_, i) => centre * (1 + spread * Math.sin(i * 1.7)));

  it("excludes the point under test from its own baseline", () => {
    const values = [...noisy(20, 10), 100];
    const scored = scoreSeries(values, 20);
    const last = scored[scored.length - 1];

    expect(last.value).toBe(100);
    // Had the point been included in its own window, the baseline would have
    // been dragged above the surrounding level.
    expect(last.baseline).toBeCloseTo(median(noisy(20, 10)), 10);
    expect(last.baseline).toBeLessThan(11);
    expect(last.score).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it("finds an injected spike and leaves the ordinary stretch alone", () => {
    const values = noisy(30, 10);
    values[20] = 95;

    const flagged = scoreSeries(values, 24).filter(
      (p) => Math.abs(p.score) > DEFAULT_THRESHOLD,
    );
    expect(flagged.map((p) => p.index)).toContain(20);
    // Nothing before the injected spike should trip the threshold.
    expect(flagged.every((p) => p.index >= 20)).toBe(true);
  });

  it("respects the lookback horizon", () => {
    // A step change: once the old regime falls out of the lookback window the
    // new level becomes the baseline and stops being reported.
    const values = [...noisy(40, 10), ...noisy(40, 50)];

    const scored = scoreSeries(values, 10);
    const lateFlags = scored.filter(
      (p) => p.index > 60 && Math.abs(p.score) > DEFAULT_THRESHOLD,
    );
    expect(lateFlags).toHaveLength(0);
  });
});
