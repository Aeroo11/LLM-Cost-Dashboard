import type { Endpoint, LLMRequest, ModelId } from "./types";
import { MODELS, computeCost } from "./models";
import type { Summary } from "./aggregate";
import { formatUsd } from "./format";

export type InsightSeverity = "high" | "medium" | "low";

export interface Insight {
  id: string;
  category: "routing" | "caching";
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Projected 30-day saving in USD if applied. */
  monthlySavingsUsd: number;
  affectedRequests: number;
  /**
   * Whether the saving is re-priced from observed events (`measured`) or rests
   * on a stated assumption the data cannot confirm (`assumption`). Surfaced in
   * the UI so a headline figure is never mistaken for a guarantee.
   */
  basis: "measured" | "assumption";
  /** The assumption in plain words, when `basis` is `assumption`. */
  assumption?: string;
  /**
   * Expected change in average quality score if the recommendation is applied,
   * on the same 0..1 scale as `qualityScore`. Negative means quality is traded
   * for cost. Routing recommendations always carry one; caching does not,
   * because a cache hit returns the identical completion.
   */
  qualityDelta?: number;
}

/**
 * Endpoints whose workload a cheaper model handles well, and the model to move
 * them to. `chat`/`rag` are intentionally absent — they genuinely benefit from
 * frontier quality, so downgrading them would be the wrong advice.
 */
export const RECOMMENDED_DOWNGRADE: Partial<Record<Endpoint, ModelId>> = {
  classify: "gpt-4o-mini",
  summarize: "claude-haiku-4-5",
};

/**
 * Fraction of RAG fresh input assumed to repeat (system prompt + retrieved
 * context) and therefore to be cacheable.
 *
 * This is an *assumption*, not a measurement: the event stream has no prompt
 * text to diff, so there is nothing to derive it from. 0.5 is deliberately
 * conservative for RAG workloads, where the retrieved block usually dominates
 * the prompt and changes less often than the user turn. The dashboard labels
 * the resulting insight as assumption-based for exactly this reason.
 */
export const RAG_CACHEABLE_FRACTION = 0.5;

export function monthlyFactor(windowHours: number): number {
  const days = windowHours / 24;
  return days > 0 ? 30 / days : 0;
}

export function severityFor(
  monthlySavings: number,
  monthlyBurn: number,
): InsightSeverity {
  if (monthlyBurn <= 0) return "low";
  const share = monthlySavings / monthlyBurn;
  if (share >= 0.08) return "high";
  if (share >= 0.03) return "medium";
  return "low";
}

/**
 * Turn the raw request stream into ranked, dollar-quantified savings
 * recommendations. Ranked by *absolute* monthly saving — the honest priority —
 * so a flashy-but-tiny finding never outranks a boring-but-large one.
 */
export function computeInsights(requests: LLMRequest[], summary: Summary): Insight[] {
  const factor = monthlyFactor(summary.windowHours);
  const monthlyBurn = summary.burnRateMonthlyUsd;
  const insights: Insight[] = [];

  // 1) Right-size over-provisioned routing.
  for (const [endpoint, target] of Object.entries(RECOMMENDED_DOWNGRADE) as [
    Endpoint,
    ModelId,
  ][]) {
    const targetSpec = MODELS[target];
    let windowSavings = 0;
    let affected = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    for (const r of requests) {
      if (r.endpoint !== endpoint || r.model === target) continue;
      if (MODELS[r.model].inputPer1M <= targetSpec.inputPer1M) continue;
      const altCost = computeCost(target, r.inputTokens, r.outputTokens, r.cachedTokens);
      const delta = r.costUsd - altCost;
      if (delta <= 0) continue;
      windowSavings += delta;
      affected += 1;
      if (r.status === "success") {
        qualitySum += r.qualityScore;
        qualityCount += 1;
      }
    }

    if (windowSavings <= 0) continue;
    const monthly = windowSavings * factor;
    // What these calls score today, versus what the cheaper model is expected
    // to score. Negative = the saving is paid for in quality.
    const observedQuality = qualityCount > 0 ? qualitySum / qualityCount : null;
    const qualityDelta =
      observedQuality === null ? undefined : targetSpec.qualityBaseline - observedQuality;

    insights.push({
      id: `route-${endpoint}`,
      category: "routing",
      severity: severityFor(monthly, monthlyBurn),
      title: `Route “${endpoint}” to ${targetSpec.label}`,
      detail: `${affected} ${endpoint} calls run on pricier models for a task ${targetSpec.label} handles at quality ${targetSpec.qualityBaseline.toFixed(2)}. Re-routing saves ≈ ${formatUsd(monthly)}/mo.`,
      monthlySavingsUsd: monthly,
      affectedRequests: affected,
      basis: "measured",
      qualityDelta,
    });
  }

  // 2) Prompt caching on RAG (large, repetitive prompts).
  let cacheSavings = 0;
  let cacheAffected = 0;
  for (const r of requests) {
    if (r.endpoint !== "rag") continue;
    const fresh = Math.max(0, r.inputTokens - r.cachedTokens);
    const addlCacheable = fresh * RAG_CACHEABLE_FRACTION;
    const spec = MODELS[r.model];
    const perToken = (spec.inputPer1M - spec.cachedInputPer1M) / 1_000_000;
    const delta = addlCacheable * perToken;
    if (delta <= 0) continue;
    cacheSavings += delta;
    cacheAffected += 1;
  }
  if (cacheSavings > 0) {
    const monthly = cacheSavings * factor;
    insights.push({
      id: "cache-rag",
      category: "caching",
      severity: severityFor(monthly, monthlyBurn),
      title: "Enable prompt caching on RAG",
      detail: `RAG prompts repeat large system + context blocks. Caching ~${Math.round(
        RAG_CACHEABLE_FRACTION * 100,
      )}% of fresh input across ${cacheAffected} calls saves ≈ ${formatUsd(monthly)}/mo.`,
      monthlySavingsUsd: monthly,
      affectedRequests: cacheAffected,
      basis: "assumption",
      assumption: `Assumes ${Math.round(
        RAG_CACHEABLE_FRACTION * 100,
      )}% of fresh RAG input is repeated content eligible for the cache. The event stream carries no prompt text, so this cannot be measured from the data — treat it as an upper-bound estimate.`,
      // A cache hit returns the identical completion, so there is no quality
      // trade-off to report here.
    });
  }

  return insights.sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);
}

export interface SavingsBreakdown {
  /** Re-priced directly from observed events. */
  measuredUsd: number;
  /** Rests on a stated assumption; shown separately rather than blended in. */
  assumedUsd: number;
  totalUsd: number;
}

/**
 * Recoverable monthly spend, split by how trustworthy each number is.
 *
 * Summing the recommendations is safe here because they operate on disjoint
 * endpoint sets — routing targets `classify`/`summarize`, caching targets
 * `rag` — so no request is counted twice. Adding a recommendation that overlaps
 * an existing one would break that and needs the overlap netted out first.
 */
export function totalMonthlySavings(insights: Insight[]): SavingsBreakdown {
  let measuredUsd = 0;
  let assumedUsd = 0;
  for (const i of insights) {
    if (i.basis === "assumption") assumedUsd += i.monthlySavingsUsd;
    else measuredUsd += i.monthlySavingsUsd;
  }
  return { measuredUsd, assumedUsd, totalUsd: measuredUsd + assumedUsd };
}
