import type { Endpoint, LLMRequest, ModelId } from "./types";
import { MODEL_IDS } from "./models";

export interface GroupStats {
  requests: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Sum of quality over successful requests (for averaging). */
  qualitySum: number;
  qualityCount: number;
}

function emptyGroup(): GroupStats {
  return {
    requests: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    qualitySum: 0,
    qualityCount: 0,
  };
}

function addToGroup(g: GroupStats, r: LLMRequest): void {
  g.requests += 1;
  g.costUsd += r.costUsd;
  g.inputTokens += r.inputTokens;
  g.outputTokens += r.outputTokens;
  g.cachedTokens += r.cachedTokens;
  if (r.status === "success") {
    g.qualitySum += r.qualityScore;
    g.qualityCount += 1;
  }
}

/** Average quality of a group, or null if it had no successful requests. */
export function avgQuality(g: GroupStats): number | null {
  return g.qualityCount > 0 ? g.qualitySum / g.qualityCount : null;
}

/** The p-th percentile (0..100) of a numeric array, via linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export interface TimeBucket {
  /** Bucket start, epoch ms. */
  t: number;
  costUsd: number;
  requests: number;
  costByModel: Record<ModelId, number>;
}

export interface Summary {
  totalCostUsd: number;
  totalRequests: number;
  avgCostPerRequest: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  /** Projected 30-day spend from the observed window. */
  burnRateMonthlyUsd: number;
  byModel: Record<ModelId, GroupStats>;
  byEndpoint: Record<Endpoint, GroupStats>;
  timeSeries: TimeBucket[];
  windowHours: number;
}

function zeroByModel(): Record<ModelId, number> {
  return MODEL_IDS.reduce(
    (acc, id) => ({ ...acc, [id]: 0 }),
    {} as Record<ModelId, number>,
  );
}

/**
 * Roll a raw request stream up into everything the UI needs. `now` and
 * `windowHours` define the observation window used for the burn-rate projection
 * and the time-series bucketing.
 */
export function summarize(
  requests: LLMRequest[],
  now: number,
  windowHours: number,
  bucketMinutes = 30,
): Summary {
  const byModel = MODEL_IDS.reduce(
    (acc, id) => ({ ...acc, [id]: emptyGroup() }),
    {} as Record<ModelId, GroupStats>,
  );
  const byEndpoint = {
    chat: emptyGroup(),
    classify: emptyGroup(),
    summarize: emptyGroup(),
    rag: emptyGroup(),
  } as Record<Endpoint, GroupStats>;

  const bucketMs = bucketMinutes * 60_000;
  const start = now - windowHours * 3600_000;
  const bucketCount = Math.ceil((windowHours * 3600_000) / bucketMs);
  const buckets: TimeBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    t: start + i * bucketMs,
    costUsd: 0,
    requests: 0,
    costByModel: zeroByModel(),
  }));

  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;
  let failures = 0;
  const latencies: number[] = [];

  for (const r of requests) {
    addToGroup(byModel[r.model], r);
    addToGroup(byEndpoint[r.endpoint], r);
    totalCost += r.costUsd;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCached += r.cachedTokens;
    if (r.status !== "success") failures += 1;
    latencies.push(r.latencyMs);

    const idx = Math.floor((r.timestamp - start) / bucketMs);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].costUsd += r.costUsd;
      buckets[idx].requests += 1;
      buckets[idx].costByModel[r.model] += r.costUsd;
    }
  }

  const total = requests.length;
  const observedDays = windowHours / 24;

  return {
    totalCostUsd: totalCost,
    totalRequests: total,
    avgCostPerRequest: total > 0 ? totalCost / total : 0,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCachedTokens: totalCached,
    errorRate: total > 0 ? failures / total : 0,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    latencyP99: percentile(latencies, 99),
    burnRateMonthlyUsd: observedDays > 0 ? (totalCost / observedDays) * 30 : 0,
    byModel,
    byEndpoint,
    timeSeries: buckets,
    windowHours,
  };
}
