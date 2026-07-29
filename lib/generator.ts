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

export interface GenerateRangeOptions {
  /** Start of the range, epoch ms (inclusive). */
  from: number;
  /** End of the range, epoch ms (exclusive). */
  to: number;
  ratePerMin: number;
  /** Base seed — combined with each minute's index to seed that minute. */
  seed: number;
}

export const MINUTE_MS = 60_000;

/**
 * Seed for a single minute of the stream. Deriving it from the *absolute*
 * minute index is what makes generation chunk-independent: minute N produces
 * the same events whether it was generated as part of a 7-day backfill or
 * appended on its own a moment later. Incremental ingestion therefore yields
 * byte-identical history to a full regeneration — the property the whole
 * live-append path depends on.
 */
function seedForMinute(baseSeed: number, minuteIndex: number): number {
  // Mix with a large odd constant so adjacent minutes don't produce
  // correlated mulberry32 streams.
  return (baseSeed ^ Math.imul(minuteIndex, 0x9e3779b1)) >>> 0;
}

/** Diurnal traffic multiplier: quiet at night, busy mid-day. */
function diurnalFactor(timestamp: number): number {
  const hour = new Date(timestamp).getUTCHours() + new Date(timestamp).getUTCMinutes() / 60;
  // Smooth bump peaking ~14:00 UTC, floor at ~0.35 overnight.
  const wave = Math.cos(((hour - 14) / 24) * 2 * Math.PI);
  return 0.35 + 0.65 * ((wave + 1) / 2);
}

/** Assign a status; timeouts/rate-limits are rarer and cluster at high load. */
function pickStatus(
  rng: () => number,
  loadFactor: number,
  incident: Incident | null,
): RequestStatus {
  const errorBoost = 0.5 + loadFactor; // busier ⇒ slightly more failures
  const storm = incident?.kind === "error_storm" ? incident.magnitude : 0;

  return weightedPick<RequestStatus>(rng, [
    ["success", Math.max(0.05, 0.975 - storm)],
    ["error", 0.009 * errorBoost + storm * 0.5],
    ["rate_limited", 0.009 * errorBoost + storm * 0.3],
    ["timeout", 0.007 * errorBoost + storm * 0.2],
  ]);
}

/* ── Incidents ──────────────────────────────────────────────────────────────
 *
 * Steady traffic makes for a dead dashboard and, more importantly, an
 * unrealistic one: production LLM workloads have bad deploys, provider
 * degradation, and runaway retrievals. Without them the anomaly detector has
 * nothing to find at 30-minute resolution and the alerts panel is decorative.
 *
 * Incidents are derived from the clock, not from accumulated state: each
 * 6-hour block deterministically decides whether it contains one, and a minute
 * asks its own block (and the previous one, for incidents that straddle the
 * boundary). That keeps generation stateless and preserves the property the
 * ingester depends on — a minute's events are the same however they were
 * chunked.
 */

type IncidentKind = "error_storm" | "latency_degradation" | "cost_spike";

interface Incident {
  kind: IncidentKind;
  start: number;
  end: number;
  /** Severity, interpreted per kind. */
  magnitude: number;
}

const INCIDENT_BLOCK_MS = 6 * 3600_000;
/** Fraction of 6-hour blocks that contain an incident. */
const INCIDENT_RATE = 0.55;

function incidentForBlock(blockIndex: number, baseSeed: number): Incident | null {
  const rng = makeRng((baseSeed ^ Math.imul(blockIndex, 0x85ebca6b)) >>> 0);
  if (rng() > INCIDENT_RATE) return null;

  const kind = weightedPick<IncidentKind>(rng, [
    ["error_storm", 0.4],
    ["latency_degradation", 0.35],
    ["cost_spike", 0.25],
  ]);

  // 25–70 minutes long, so it spans several buckets even at 30-minute
  // resolution and reads as an incident rather than a single odd sample.
  const durationMs = (25 + rng() * 45) * MINUTE_MS;
  const start = blockIndex * INCIDENT_BLOCK_MS + rng() * (INCIDENT_BLOCK_MS - durationMs);

  const magnitude =
    kind === "error_storm"
      ? 0.12 + rng() * 0.35 // 12–47% of calls start failing
      : kind === "latency_degradation"
        ? 2.5 + rng() * 3.5 // 2.5–6× slower
        : 3 + rng() * 5; // 3–8× the usual input size

  return { kind, start: Math.round(start), end: Math.round(start + durationMs), magnitude };
}

function incidentAt(t: number, baseSeed: number): Incident | null {
  const block = Math.floor(t / INCIDENT_BLOCK_MS);
  // The previous block is checked too, so an incident crossing the boundary is
  // not silently truncated.
  for (const b of [block, block - 1]) {
    const incident = incidentForBlock(b, baseSeed);
    if (incident && t >= incident.start && t < incident.end) return incident;
  }
  return null;
}

/**
 * Generate the events for a single wall-clock minute. This is the atomic unit
 * of the stream: deterministic in `minuteStart` alone, so it can be produced
 * during a backfill or appended live with identical results.
 */
function generateMinute(
  minuteStart: number,
  ratePerMin: number,
  baseSeed: number,
): LLMRequest[] {
  const minuteIndex = Math.floor(minuteStart / MINUTE_MS);
  const rng = makeRng(seedForMinute(baseSeed, minuteIndex));
  const end = minuteStart + MINUTE_MS;
  const load = diurnalFactor(minuteStart);
  const effectiveRate = (ratePerMin * load) / MINUTE_MS; // per ms
  const incident = incidentAt(minuteStart, baseSeed);

  const requests: LLMRequest[] = [];
  let t = minuteStart;
  let counter = 0;

  while (true) {
    t += exponential(rng, effectiveRate);
    if (t >= end) break;

    const endpoint = weightedPick(rng, ENDPOINTS);
    const profile = PROFILES[endpoint];
    const model = weightedPick(rng, profile.routing);
    const spec = MODELS[model];

    // A cost-spike incident is a runaway retrieval: the prompt balloons while
    // everything else about the request stays ordinary.
    const inputBlowup = incident?.kind === "cost_spike" ? incident.magnitude : 1;
    const inputTokens = clampInt(
      lognormal(rng, profile.inMu, profile.inSigma) * inputBlowup,
      20,
      32_000,
    );
    const outputTokens = clampInt(lognormal(rng, profile.outMu, profile.outSigma), 1, 8_000);
    // Only some of the cacheable input is actually cache-hit right now.
    const cacheable = inputTokens * profile.cacheRatio;
    const cachedTokens = clampInt(cacheable * rng() * 0.9, 0, inputTokens);

    const status = pickStatus(rng, load, incident);
    const failed = status !== "success";

    // Latency scales with output size, with a heavy right tail + rare spikes.
    const spike = rng() < 0.03 ? lognormal(rng, E(3), 0.4) : 1;
    const degradation =
      incident?.kind === "latency_degradation" ? incident.magnitude : 1;
    const latencyMs = clampInt(
      lognormal(rng, Math.log(spec.baseLatencyMs), 0.35) *
        (1 + outputTokens / 900) *
        spike *
        degradation,
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
      // Minute index + intra-minute counter is globally unique and stable
      // across regeneration, so re-ingesting a minute is idempotent.
      id: `req_${minuteIndex}_${counter++}`,
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

/**
 * Generate the stream over [from, to). Pure given its options — no Date.now()
 * or Math.random() inside.
 *
 * Minutes are the unit of generation, but the bounds are honoured exactly: the
 * minutes overlapping the range are produced in full and then trimmed to it.
 * Because each minute is seeded from its own absolute index, that yields
 *
 *     generateRange(a, c) === generateRange(a, b) ++ generateRange(b, c)
 *
 * for *any* split point b, not just minute boundaries. The test suite asserts
 * this. It is what lets the ingester append a few seconds of new events every
 * tick — so the dashboard actually moves — while still producing byte-identical
 * history to a single backfill.
 */
export function generateRange(opts: GenerateRangeOptions): LLMRequest[] {
  const { from, to, ratePerMin, seed } = opts;
  if (to <= from) return [];

  const firstMinute = Math.floor(from / MINUTE_MS) * MINUTE_MS;
  const requests: LLMRequest[] = [];

  for (let t = firstMinute; t < to; t += MINUTE_MS) {
    for (const r of generateMinute(t, ratePerMin, seed)) {
      if (r.timestamp >= from && r.timestamp < to) requests.push(r);
    }
  }
  return requests;
}

/** Convenience wrapper: the trailing `windowHours` up to `now`. */
export function generateRequests(opts: GenerateOptions): LLMRequest[] {
  const { now, windowHours, ratePerMin, seed } = opts;
  return generateRange({
    from: now - windowHours * 3600_000,
    to: now,
    ratePerMin,
    seed,
  });
}
