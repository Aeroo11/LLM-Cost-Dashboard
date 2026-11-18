import { describe, expect, it } from "vitest";
import type { TimeBucket } from "./aggregate";
import { toSparkline, toSparklineRequests } from "./series";

function buckets(costs: number[]): TimeBucket[] {
  return costs.map((costUsd, i) => ({
    t: i * 60_000,
    costUsd,
    requests: Math.round(costUsd * 10),
    costByModel: {
      "gpt-4o": costUsd,
      "gpt-4o-mini": 0,
      "claude-sonnet-5": 0,
      "claude-haiku-4-5": 0,
    },
  }));
}

describe("toSparkline", () => {
  it("returns exactly n points when the input is longer", () => {
    expect(toSparkline(buckets(Array(48).fill(1)), 12)).toHaveLength(12);
    expect(toSparkline(buckets(Array(56).fill(1)), 12)).toHaveLength(12);
    expect(toSparkline(buckets(Array(30).fill(1)), 12)).toHaveLength(12);
  });

  it("preserves the total — the fold sums, it does not sample", () => {
    const input = buckets([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const total = 14 * 15 / 2;
    expect(toSparkline(input, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(total);
  });

  it("spreads the remainder instead of piling it into the last group", () => {
    // Each bucket contributes 1, so each output value *is* its group size.
    // 14 into 4 must land on 3s and 4s — never 3,3,3,5.
    const out = toSparkline(buckets(Array(14).fill(1)), 4);
    expect(Math.max(...out)).toBe(4);
    expect(Math.min(...out)).toBe(3);
    expect(out.reduce((a, b) => a + b, 0)).toBe(14);
  });

  it("returns the series unchanged when it is shorter than n", () => {
    // Padding with zeros would draw a downward trend that isn't in the data.
    expect(toSparkline(buckets([5, 6, 7]), 12)).toEqual([5, 6, 7]);
  });

  it("handles the empty and degenerate cases", () => {
    expect(toSparkline([], 12)).toEqual([]);
    expect(toSparkline(buckets([1, 2, 3]), 0)).toEqual([]);
  });

  it("folds request counts through the same grouping", () => {
    // requests = cost * 10 in the fixture, so the folded series scales likewise.
    const input = buckets([1, 2, 3, 4]);
    expect(toSparklineRequests(input, 2)).toEqual([30, 70]);
  });
});
