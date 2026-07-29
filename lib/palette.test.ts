import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART, SEVERITY_COLOR } from "./palette";

/**
 * SVG presentation attributes need literal hex and a stylesheet can't be
 * imported from TypeScript, so the chart chrome and severity colours exist in
 * two places by necessity. These tests make the duplication provably
 * non-drifting rather than aspirationally so: change one side and CI fails.
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function tokenValue(name: string): string | undefined {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  return match?.[1].toLowerCase();
}

describe("palette ↔ globals.css", () => {
  it.each([
    ["chart-grid", CHART.grid],
    ["chart-axis", CHART.axis],
    ["chart-ink", CHART.ink],
    ["surface", CHART.surface],
  ])("--%s matches the CHART literal", (token, expected) => {
    expect(tokenValue(token)).toBe(expected.toLowerCase());
  });

  it.each([
    ["sev-high", SEVERITY_COLOR.high],
    ["sev-medium", SEVERITY_COLOR.medium],
    ["sev-low", SEVERITY_COLOR.low],
  ])("--%s matches the SEVERITY_COLOR literal", (token, expected) => {
    expect(tokenValue(token)).toBe(expected.toLowerCase());
  });

  it("keeps status colours out of the categorical series palette", async () => {
    const { MODEL_COLORS } = await import("./palette");
    const series = Object.values(MODEL_COLORS).map((c) => c.toLowerCase());
    for (const status of Object.values(SEVERITY_COLOR)) {
      expect(series).not.toContain(status.toLowerCase());
    }
  });
});
