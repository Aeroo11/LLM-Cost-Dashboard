import type { ModelId } from "./types";

export interface ModelSpec {
  id: ModelId;
  label: string;
  vendor: "OpenAI" | "Anthropic";
  tier: "frontier" | "mid" | "small";
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens (always pricier than input). */
  outputPer1M: number;
  /** USD per 1M cached input tokens. */
  cachedInputPer1M: number;
  /** Typical quality on a 0..1 scale — bigger models score higher. */
  qualityBaseline: number;
  /** Median latency in ms for a small response. */
  baseLatencyMs: number;
}

/**
 * Representative 2026-era pricing (USD per 1M tokens). Numbers are realistic but
 * illustrative — the point is the *relationships*: output ≫ input, cache ≪ input,
 * and frontier models cost ~15–20× a small model for a modest quality bump.
 */
export const MODELS: Record<ModelId, ModelSpec> = {
  "gpt-4o": {
    id: "gpt-4o",
    label: "GPT-4o",
    vendor: "OpenAI",
    tier: "frontier",
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    cachedInputPer1M: 1.25,
    qualityBaseline: 0.93,
    baseLatencyMs: 900,
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    vendor: "Anthropic",
    tier: "frontier",
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cachedInputPer1M: 0.3,
    qualityBaseline: 0.95,
    baseLatencyMs: 1050,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    vendor: "Anthropic",
    tier: "mid",
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    cachedInputPer1M: 0.08,
    qualityBaseline: 0.86,
    baseLatencyMs: 550,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    vendor: "OpenAI",
    tier: "small",
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cachedInputPer1M: 0.075,
    qualityBaseline: 0.8,
    baseLatencyMs: 420,
  },
};

export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

/**
 * Billed cost of a single request. Fresh (uncached) input, cached input, and
 * output are each priced separately — this is exactly how real providers bill.
 */
export function computeCost(
  model: ModelId,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const spec = MODELS[model];
  const freshInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (freshInput * spec.inputPer1M +
      cachedTokens * spec.cachedInputPer1M +
      outputTokens * spec.outputPer1M) /
    1_000_000
  );
}
