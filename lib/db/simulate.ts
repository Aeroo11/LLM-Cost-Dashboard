import "server-only";

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Endpoint, ModelId } from "../types";
import { MODEL_IDS } from "../models";
import { buildPredicate, ENDPOINT_IDS, type MetricFilters, type SqlParam, type TimeRange } from "./filters";

/**
 * What-if simulator.
 *
 * Re-prices the observed traffic under a hypothetical configuration. This is
 * the payoff of keeping the price book in a table rather than only in
 * TypeScript: changing which model served a request is a different join, so the
 * whole scenario — routing changes, a different cache hit rate, more traffic —
 * is one pass over the fact table instead of a simulation loop.
 *
 * What it is *not*: a prediction. Re-routing is priced exactly, because token
 * counts and the price book are both known. The projected quality is an
 * estimate built from each model's baseline score, and the UI says so.
 */

export interface RoutingOverride {
  endpoint: Endpoint;
  targetModel: ModelId;
  /** Share of that endpoint's traffic to move, 0..1. */
  share: number;
}

export interface Scenario {
  routing: RoutingOverride[];
  /** Override the cache hit ratio on input tokens (0..1), or null to observe. */
  cacheHitRate: number | null;
  /** Multiplier on traffic volume. 1 = as observed. */
  trafficMultiplier: number;
}

export const BASELINE_SCENARIO: Scenario = {
  routing: [],
  cacheHitRate: null,
  trafficMultiplier: 1,
};

export interface ScenarioModelRow {
  model: ModelId;
  baselineUsd: number;
  scenarioUsd: number;
  baselineRequests: number;
  scenarioRequests: number;
}

export interface ScenarioResult {
  /** Observed spend over the window, projected to 30 days. */
  baselineMonthlyUsd: number;
  /** Spend under the scenario, projected to 30 days. */
  scenarioMonthlyUsd: number;
  deltaUsd: number;
  deltaPct: number;
  /** Mean quality of successful calls, observed vs projected. */
  baselineQuality: number;
  scenarioQuality: number;
  /** Requests whose serving model changed. */
  movedRequests: number;
  totalRequests: number;
  byModel: ScenarioModelRow[];
}

function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

/** Validate anything arriving from the client before it reaches a query. */
export function parseScenario(raw: unknown): Scenario {
  const o = (raw ?? {}) as Record<string, unknown>;

  const routing: RoutingOverride[] = Array.isArray(o.routing)
    ? (o.routing as unknown[])
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>;
          return {
            endpoint: e.endpoint as Endpoint,
            targetModel: e.targetModel as ModelId,
            share: clamp(Number(e.share), 0, 1),
          };
        })
        .filter(
          (e) =>
            ENDPOINT_IDS.includes(e.endpoint) &&
            MODEL_IDS.includes(e.targetModel) &&
            e.share > 0,
        )
        // One override per endpoint; a later duplicate replaces an earlier one.
        .filter(
          (e, i, arr) => arr.findIndex((x) => x.endpoint === e.endpoint) === i,
        )
    : [];

  const rawCache = o.cacheHitRate;
  const cacheHitRate =
    rawCache === null || rawCache === undefined ? null : clamp(Number(rawCache), 0, 1);

  return {
    routing,
    cacheHitRate,
    trafficMultiplier: clamp(Number(o.trafficMultiplier ?? 1), 0.1, 10),
  };
}

/**
 * Deterministic membership in the moved share.
 *
 * `hash(id) % 1000 < share*1000` picks a stable pseudo-random subset: the same
 * request is always on the same side of the split, so nudging an unrelated
 * slider never reshuffles which calls moved and the projected cost stays steady
 * instead of jittering.
 */
function routingCase(overrides: RoutingOverride[], params: SqlParam[]): string {
  if (overrides.length === 0) return "r.model";

  const arms = overrides.map((o) => {
    const endpointParam = `$${params.push(o.endpoint)}`;
    const shareParam = `$${params.push(Math.round(o.share * 1000))}`;
    const targetParam = `$${params.push(o.targetModel)}`;
    return `WHEN r.endpoint = ${endpointParam} AND (hash(r.id) % 1000) < ${shareParam}::BIGINT THEN ${targetParam}`;
  });

  return `CASE ${arms.join(" ")} ELSE r.model END`;
}

export async function simulate(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const p = buildPredicate(range, filters);
  const params = [...p.params];

  const simModel = routingCase(scenario.routing, params);

  // A null cache override means "use what was observed".
  const cacheExpr =
    scenario.cacheHitRate === null
      ? "r.cached_tokens"
      : `least(r.input_tokens, r.input_tokens * $${params.push(scenario.cacheHitRate)}::DOUBLE)`;

  const multParam = `$${params.push(scenario.trafficMultiplier)}`;

  const reader = await connection.runAndReadAll(
    /* sql */ `
      WITH sim AS (
        SELECT
          r.model            AS base_model,
          ${simModel}        AS sim_model,
          r.cost_usd         AS base_cost,
          ${cacheExpr}       AS sim_cached,
          r.input_tokens, r.output_tokens, r.quality_score, r.status
        FROM v_requests r
        WHERE ${p.sql}
      ),
      priced AS (
        SELECT
          sim.*,
          (
              (sim.input_tokens - sim.sim_cached) * t.input_per_1m
            +  sim.sim_cached                     * t.cached_input_per_1m
            +  sim.output_tokens                  * t.output_per_1m
          ) / 1e6                                        AS sim_cost,
          -- Re-routed calls are projected at the target model's baseline
          -- quality; untouched calls keep the score they actually scored.
          CASE WHEN sim.sim_model = sim.base_model
               THEN sim.quality_score
               ELSE t.quality_baseline END               AS sim_quality
        FROM sim
        JOIN models t ON t.id = sim.sim_model
      )
      SELECT
        count(*)                                                    AS total_requests,
        count(*) FILTER (WHERE sim_model <> base_model)             AS moved_requests,
        coalesce(sum(base_cost), 0)                                 AS base_cost,
        coalesce(sum(sim_cost), 0) * ${multParam}::DOUBLE           AS sim_cost,
        coalesce(avg(quality_score) FILTER (WHERE status = 'success'), 0) AS base_quality,
        coalesce(avg(sim_quality)   FILTER (WHERE status = 'success'), 0) AS sim_quality
      FROM priced
    `,
    params,
  );

  const row = reader.getRowObjects()[0] ?? {};

  const perModel = await connection.runAndReadAll(
    /* sql */ `
      WITH sim AS (
        SELECT
          r.model      AS base_model,
          ${simModel}  AS sim_model,
          r.cost_usd   AS base_cost,
          ${cacheExpr} AS sim_cached,
          r.input_tokens, r.output_tokens
        FROM v_requests r
        WHERE ${p.sql}
      ),
      priced AS (
        SELECT sim.*,
          (
              (sim.input_tokens - sim.sim_cached) * t.input_per_1m
            +  sim.sim_cached                     * t.cached_input_per_1m
            +  sim.output_tokens                  * t.output_per_1m
          ) / 1e6 AS sim_cost
        FROM sim JOIN models t ON t.id = sim.sim_model
      ),
      base AS (
        SELECT base_model AS model, sum(base_cost) AS usd, count(*) AS n
        FROM priced GROUP BY 1
      ),
      scen AS (
        SELECT sim_model AS model,
               sum(sim_cost) * ${multParam}::DOUBLE AS usd,
               count(*)                             AS n
        FROM priced GROUP BY 1
      )
      SELECT
        m.id                              AS model,
        coalesce(base.usd, 0)             AS base_usd,
        coalesce(scen.usd, 0)             AS scen_usd,
        coalesce(base.n, 0)               AS base_n,
        coalesce(scen.n, 0)               AS scen_n
      FROM models m
      LEFT JOIN base ON base.model = m.id
      LEFT JOIN scen ON scen.model = m.id
      ORDER BY scen_usd DESC
    `,
    params,
  );

  // Project the window onto 30 days using the window's *actual* span.
  const observedDays = (range.toMs - range.fromMs) / 86_400_000;
  const toMonthly = observedDays > 0 ? 30 / observedDays : 0;

  const baselineMonthlyUsd = num(row.base_cost) * toMonthly;
  const scenarioMonthlyUsd = num(row.sim_cost) * toMonthly;

  return {
    baselineMonthlyUsd,
    scenarioMonthlyUsd,
    deltaUsd: scenarioMonthlyUsd - baselineMonthlyUsd,
    deltaPct:
      baselineMonthlyUsd > 0
        ? ((scenarioMonthlyUsd - baselineMonthlyUsd) / baselineMonthlyUsd) * 100
        : 0,
    baselineQuality: num(row.base_quality),
    scenarioQuality: num(row.sim_quality),
    movedRequests: num(row.moved_requests),
    totalRequests: num(row.total_requests),
    byModel: perModel.getRowObjects().map((r) => ({
      model: String(r.model) as ModelId,
      baselineUsd: num(r.base_usd) * toMonthly,
      scenarioUsd: num(r.scen_usd) * toMonthly,
      baselineRequests: num(r.base_n),
      scenarioRequests: num(r.scen_n),
    })),
  };
}
