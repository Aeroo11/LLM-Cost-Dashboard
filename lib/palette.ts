import type { ModelId } from "./types";

/**
 * Fixed model → colour assignment. Colours follow the *entity*, never its rank,
 * so filtering or re-sorting never repaints a series.
 *
 * These are dark categorical slots 1, 6, 5 and 4 from the dataviz reference
 * palette. Validated against this app's chart surface (#13151c): every adjacent
 * pair passes — the pairlist that governs the stacked areas and bars.
 *
 * Under the all-pairs rule that governs the *scatter* (cost-vs-quality), yellow
 * ↔ green measure ΔE 6.9 protan, inside the 6–8 band that is legal only with
 * secondary encoding. That is why cost-vs-quality.tsx direct-labels every
 * bubble; the labels are load-bearing, not decoration.
 *
 *   node scripts/validate_palette.js "#3987e5,#008300,#d55181,#c98500" \
 *     --mode dark --surface "#13151c" [--pairs all]
 */
export const MODEL_ORDER: ModelId[] = [
  "gpt-4o",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gpt-4o-mini",
];

export const MODEL_COLORS: Record<ModelId, string> = {
  "gpt-4o": "#3987e5", // blue
  "claude-sonnet-5": "#008300", // green
  "claude-haiku-4-5": "#d55181", // magenta
  "gpt-4o-mini": "#c98500", // yellow
};

/**
 * Chart chrome, mirroring the --chart-* tokens in app/globals.css.
 *
 * The duplication is forced: SVG presentation attributes need literal hex, and
 * a stylesheet can't be imported from TypeScript. So this file is the source of
 * truth for anything SVG touches, and lib/palette.test.ts asserts the two stay
 * in agreement rather than trusting them to.
 */
export const CHART = {
  grid: "#262a35",
  axis: "#9aa0ad",
  surface: "#13151c",
  /** Text token for in-chart labels. Chart text never wears a series colour. */
  ink: "#e7e9ee",
} as const;

export type Severity = "high" | "medium" | "low";

/**
 * The reserved *status* palette (serious / warning / neutral), shared by the
 * insights and anomaly panels.
 *
 * Deliberately distinct from both MODEL_COLORS — so a status hue never
 * impersonates a series — and from --warning/--danger, which are UI chrome.
 * Mirrors --sev-* in app/globals.css. Never used colour-alone: every mark that
 * wears one ships with an icon and a text label beside it.
 */
export const SEVERITY_COLOR: Record<Severity, string> = {
  high: "#ec835a",
  medium: "#fab219",
  low: "#9aa0ad",
};
