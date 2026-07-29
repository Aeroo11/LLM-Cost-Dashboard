import type { Endpoint, LLMRequest, ModelId, RequestStatus } from "./types";
import { MODELS, computeCost } from "./models";
import {
  clampInt,
  exponential,
  gaussian,
  lognormal,
  makeRng,
  weightedPick,
} from "./random";

/**
 * Per-endpoint token profile (log-space params) and cache behaviour.
 *   in*  → input token distribution      out* → output token distribution
 *   cacheRatio → fraction of input that *could* be served from cache
 */
interface EndpointProfile {
  inMu: number;
  inSigma: number;
  outMu: number;
  outSigma: number;
  cacheRatio: number;
  /** How this workload is routed across models — [model, weight] pairs. */
  routing: Array<[ModelId, number]>;
}

const E = Math.log; // readability: E(300) ≈ log-space mean for ~300 tokens

const PROFILES: Record<Endpoint, EndpointProfile> = {
  // Cheap, high-volume task. NOTE the "leak": 35% is routed to GPT-4o — the
  // single biggest savings opportunity the Insights panel will surface later.
  classify: {
    inMu: E(280),
    inSigma: 0.4,
    outMu: E(6),
    outSigma: 0.5,
    cacheRatio: 0.7,
    routing: [
      ["gpt-4o-mini", 0.55],
      ["claude-haiku-4-5", 0.1],
      ["gpt-4o", 0.35],
    ],
  },
  // Interactive; genuinely benefits from stronger models.
  chat: {
    inMu: E(750),
    inSigma: 0.6,
    outMu: E(380),
    outSigma: 0.7,
    cacheRatio: 0.25,
    routing: [
      ["claude-sonnet-5", 0.35],
      ["gpt-4o", 0.3],
      ["claude-haiku-4-5", 0.25],
      ["gpt-4o-mini", 0.1],
    ],
  },
  // Large input, small output — a mid model is plenty.
  summarize: {
    inMu: E(3000),
    inSigma: 0.5,
    outMu: E(240),
    outSigma: 0.5,
    cacheRatio: 0.15,
    routing: [
      ["claude-haiku-4-5", 0.5],
      ["gpt-4o-mini", 0.25],
      ["gpt-4o", 0.25],
    ],
  },
  // Retrieval-augmented: huge, repetitive input (system + retrieved chunks) that
  // is under-cached here — the second savings lever (prompt caching).
  rag: {
    inMu: E(4200),
    inSigma: 0.45,
    outMu: E(520),
    outSigma: 0.6,
    cacheRatio: 0.55,
    routing: [
      ["claude-sonnet-5", 0.45],
      ["gpt-4o", 0.35],
      ["claude-haiku-4-5", 0.2],
    ],
  },
};

const ENDPOINTS: Array<[Endpoint, number]> = [
  ["chat", 0.4],
  ["classify", 0.3],
  ["rag", 0.2],
  ["summarize", 0.1],
];

export interface GenerateOptions {
  /** Anchor time (epoch ms) — the end of the window. Pass Date.now() at the edge. */
  now: number;
  /** How far back to generate, in hours. */
  windowHours: number;
  /** Average requests per minute (before diurnal variation). */
  ratePerMin: number;
  /** PRNG seed — same seed ⇒ identical stream. */
  seed: number;
}

/** Diurnal traffic multiplier: quiet at night, busy mid-day. */
function diurnalFactor(timestamp: number): number {
  const hour = new Date(timestamp).getUTCHours() + new Date(timestamp).getUTCMinutes() / 60;
  // Smooth bump peaking ~14:00 UTC, floor at ~0.35 overnight.
  const wave = Math.cos(((hour - 14) / 24) * 2 * Math.PI);
  return 0.35 + 0.65 * ((wave + 1) / 2);
}

/** Assign a status; timeouts/rate-limits are rarer and cluster at high load. */
function pickStatus(rng: () => number, loadFactor: number): RequestStatus {
  const errorBoost = 0.5 + loadFactor; // busier ⇒ slightly more failures
  return weightedPick<RequestStatus>(rng, [
    ["success", 0.975],
    ["error", 0.009 * errorBoost],
    ["rate_limited", 0.009 * errorBoost],
    ["timeout", 0.007 * errorBoost],
  ]);
}

/**
 * Generate a reproducible stream of LLM requests over [now - windowHours, now].
 * Pure given its options — no Date.now()/Math.random() inside.
 */
export function generateRequests(opts: GenerateOptions): LLMRequest[] {
  const { now, windowHours, ratePerMin, seed } = opts;
  const rng = makeRng(seed);
  const start = now - windowHours * 3600_000;
  const requests: LLMRequest[] = [];

  let t = start;
  let counter = 0;

  while (t < now) {
    const load = diurnalFactor(t);
    const effectiveRate = (ratePerMin * load) / 60_000; // per ms
    t += exponential(rng, effectiveRate);
    if (t >= now) break;

    const endpoint = weightedPick(rng, ENDPOINTS);
    const profile = PROFILES[endpoint];
    const model = weightedPick(rng, profile.routing);
    const spec = MODELS[model];

    const inputTokens = clampInt(lognormal(rng, profile.inMu, profile.inSigma), 20, 32_000);
    const outputTokens = clampInt(lognormal(rng, profile.outMu, profile.outSigma), 1, 8_000);
    // Only some of the cacheable input is actually cache-hit right now.
    const cacheable = inputTokens * profile.cacheRatio;
    const cachedTokens = clampInt(cacheable * rng() * 0.9, 0, inputTokens);

    const status = pickStatus(rng, load);
    const failed = status !== "success";

    // Latency scales with output size, with a heavy right tail + rare spikes.
    const spike = rng() < 0.03 ? lognormal(rng, E(3), 0.4) : 1;
    const latencyMs = clampInt(
      lognormal(rng, Math.log(spec.baseLatencyMs), 0.35) *
        (1 + outputTokens / 900) *
        spike,
      80,
      120_000,
    );

    // Failed requests still cost the input tokens; no output produced.
    const billedOutput = failed ? 0 : outputTokens;
    const costUsd = computeCost(model, inputTokens, billedOutput, cachedTokens);

    // Quality centred on the model's baseline, penalised on failure.
    const quality = failed
      ? 0
      : Math.max(0, Math.min(1, spec.qualityBaseline + gaussian(rng) * 0.05));

    requests.push({
      id: `req_${seed}_${counter++}`,
      timestamp: Math.round(t),
      model,
      endpoint,
      inputTokens,
      outputTokens: billedOutput,
      cachedTokens,
      latencyMs,
      status,
      qualityScore: Number(quality.toFixed(3)),
      costUsd,
    });
  }

  return requests;
}
