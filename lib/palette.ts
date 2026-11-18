import type { ModelId } from "./types";

/**
 * Fixed model → colour assignment. Colours follow the *entity*, never its rank,
 * so filtering or re-sorting never repaints a series.
 *
 * Pair the categorical colours with named legends and direct labels so chart
 * series can be identified by text as well as hue.
 */
export const MODEL_ORDER: ModelId[] = [
  "gpt-4o",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gpt-4o-mini",
];

export const MODEL_COLORS: Record<ModelId, string> = {
  "gpt-4o": "#3459c4",
  "claude-sonnet-5": "#08796d",
  "claude-haiku-4-5": "#a14978",
  "gpt-4o-mini": "#956200",
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
  grid: "#dce3ee",
  axis: "#5b6d88",
  surface: "#ffffff",
  /** Text token for in-chart labels. Chart text never wears a series colour. */
  ink: "#17243c",
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
  high: "#a34125",
  medium: "#88610a",
  low: "#52627a",
};
