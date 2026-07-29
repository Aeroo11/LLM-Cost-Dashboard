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
}

/**
 * Endpoints whose workload a cheaper model handles well, and the model to move
 * them to. `chat`/`rag` are intentionally absent — they genuinely benefit from
 * frontier quality, so downgrading them would be the wrong advice.
 */
const RECOMMENDED_DOWNGRADE: Partial<Record<Endpoint, ModelId>> = {
  classify: "gpt-4o-mini",
  summarize: "claude-haiku-4-5",
};

/** Fraction of RAG fresh input that repeats (system + retrieved context). */
const RAG_CACHEABLE_FRACTION = 0.5;

function monthlyFactor(windowHours: number): number {
  const days = windowHours / 24;
  return days > 0 ? 30 / days : 0;
}

function severityFor(monthlySavings: number, monthlyBurn: number): InsightSeverity {
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

    for (const r of requests) {
      if (r.endpoint !== endpoint || r.model === target) continue;
      if (MODELS[r.model].inputPer1M <= targetSpec.inputPer1M) continue;
      const altCost = computeCost(target, r.inputTokens, r.outputTokens, r.cachedTokens);
      const delta = r.costUsd - altCost;
      if (delta <= 0) continue;
      windowSavings += delta;
      affected += 1;
    }

    if (windowSavings <= 0) continue;
    const monthly = windowSavings * factor;
    insights.push({
      id: `route-${endpoint}`,
      category: "routing",
      severity: severityFor(monthly, monthlyBurn),
      title: `Route “${endpoint}” to ${targetSpec.label}`,
      detail: `${affected} ${endpoint} calls run on pricier models for a task ${targetSpec.label} handles at quality ${targetSpec.qualityBaseline.toFixed(2)}. Re-routing saves ≈ ${formatUsd(monthly)}/mo.`,
      monthlySavingsUsd: monthly,
      affectedRequests: affected,
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
    });
  }

  return insights.sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);
}

/** Total recoverable monthly spend across all recommendations. */
export function totalMonthlySavings(insights: Insight[]): number {
  return insights.reduce((sum, i) => sum + i.monthlySavingsUsd, 0);
}
