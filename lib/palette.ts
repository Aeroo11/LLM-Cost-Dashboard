import type { ModelId } from "./types";

/**
 * Fixed model → colour assignment. Colours follow the *entity*, never its rank,
 * so filtering or re-sorting never repaints a series. These four hues are the
 * dataviz reference palette's dark categorical slots 1–4, validated (all-pairs)
 * against our chart surface — CVD-safe when paired with the direct labels and
 * legends the charts already carry.
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

/** Chart chrome, matched to the app's dark surface tokens. */
export const CHART = {
  grid: "#262a35",
  axis: "#9aa0ad",
  surface: "#13151c",
} as const;
