import "server-only";

import type { DuckDBConnection } from "@duckdb/node-api";
import type { Endpoint, ModelId } from "../types";
import { MODELS } from "../models";
import {
  monthlyFactor,
  RAG_CACHEABLE_FRACTION,
  RECOMMENDED_DOWNGRADE,
  severityFor,
  type Insight,
} from "../insights";
import { formatUsd } from "../format";
import { buildPredicate, type MetricFilters, type TimeRange } from "./filters";

/**
 * SQL implementation of the savings recommendations.
 *
 * The TypeScript version in `lib/insights.ts` iterates the event array; this one
 * pushes the same arithmetic into DuckDB. Re-pricing a request against a
 * different model is a join against the `models` dimension rather than a lookup
 * in a loop, so the whole calculation is one pass over the fact table and never
 * materialises 50k rows in JavaScript. The two are reconciled in the tests.
 */

function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return 0;
}

/**
 * Cost of a request re-priced against model `t`, in USD.
 *
 * Mirrors `computeCost()`: fresh input, cached input and output are billed at
 * three different rates. `1e6` because the price book is per 1M tokens.
 */
const REPRICE = /* sql */ `
  (
      (r.input_tokens - r.cached_tokens) * t.input_per_1m
    +  r.cached_tokens                   * t.cached_input_per_1m
    +  r.output_tokens                   * t.output_per_1m
  ) / 1e6
`;

async function routingInsight(
  connection: DuckDBConnection,
  endpoint: Endpoint,
  target: ModelId,
  range: TimeRange,
  filters: MetricFilters,
  factor: number,
  monthlyBurn: number,
): Promise<Insight | null> {
  const p = buildPredicate(range, filters);
  const endpointParam = `$${p.params.length + 1}`;
  const targetParam = `$${p.params.length + 2}`;

  const reader = await connection.runAndReadAll(
    /* sql */ `
      WITH repriced AS (
        SELECT
          r.cost_usd - ${REPRICE} AS delta,
          r.quality_score,
          r.status
        FROM v_requests r
        JOIN models m ON m.id = r.model
        JOIN models t ON t.id = ${targetParam}
        WHERE ${p.sql}
          AND r.endpoint = ${endpointParam}
          AND r.model <> ${targetParam}
          -- Only consider genuinely pricier models; never "upgrade" into a
          -- more expensive one and call it a saving.
          AND m.input_per_1m > t.input_per_1m
      )
      SELECT
        count(*)                                                  AS affected,
        coalesce(sum(delta), 0)                                   AS savings,
        coalesce(sum(quality_score) FILTER (WHERE status = 'success'), 0) AS quality_sum,
        count(*) FILTER (WHERE status = 'success')                AS quality_count
      FROM repriced
      -- Per-row, not in aggregate: a request that would cost *more* on the
      -- target must not be netted against ones that would cost less.
      WHERE delta > 0
    `,
    [...p.params, endpoint, target],
  );

  const row = reader.getRowObjects()[0] ?? {};
  const savings = num(row.savings);
  const affected = num(row.affected);
  if (savings <= 0 || affected === 0) return null;

  const targetSpec = MODELS[target];
  const monthly = savings * factor;
  const qualityCount = num(row.quality_count);
  const qualityDelta =
    qualityCount > 0
      ? targetSpec.qualityBaseline - num(row.quality_sum) / qualityCount
      : undefined;

  return {
    id: `route-${endpoint}`,
    category: "routing",
    severity: severityFor(monthly, monthlyBurn),
    title: `Route “${endpoint}” to ${targetSpec.label}`,
    detail: `${affected} ${endpoint} calls run on pricier models for a task ${targetSpec.label} handles at quality ${targetSpec.qualityBaseline.toFixed(2)}. Re-routing saves ≈ ${formatUsd(monthly)}/mo.`,
    monthlySavingsUsd: monthly,
    affectedRequests: affected,
    routing: { endpoint, targetModel: target },
    basis: "measured",
    qualityDelta,
  };
}

async function cachingInsight(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  factor: number,
  monthlyBurn: number,
): Promise<Insight | null> {
  const p = buildPredicate(range, filters);
  const fractionParam = `$${p.params.length + 1}`;

  const reader = await connection.runAndReadAll(
    /* sql */ `
      WITH candidate AS (
        SELECT
          r.fresh_input_tokens * ${fractionParam}::DOUBLE
            * (m.input_per_1m - m.cached_input_per_1m) / 1e6 AS delta
        FROM v_requests r
        JOIN models m ON m.id = r.model
        WHERE ${p.sql} AND r.endpoint = 'rag'
      )
      SELECT count(*) AS affected, coalesce(sum(delta), 0) AS savings
      FROM candidate
      WHERE delta > 0
    `,
    [...p.params, RAG_CACHEABLE_FRACTION],
  );

  const row = reader.getRowObjects()[0] ?? {};
  const savings = num(row.savings);
  const affected = num(row.affected);
  if (savings <= 0) return null;

  const monthly = savings * factor;
  return {
    id: "cache-rag",
    category: "caching",
    severity: severityFor(monthly, monthlyBurn),
    title: "Enable prompt caching on RAG",
    detail: `RAG prompts repeat large system + context blocks. Caching ~${Math.round(
      RAG_CACHEABLE_FRACTION * 100,
    )}% of fresh input across ${affected} calls saves ≈ ${formatUsd(monthly)}/mo.`,
    monthlySavingsUsd: monthly,
    affectedRequests: affected,
    basis: "assumption",
    assumption: `Assumes ${Math.round(
      RAG_CACHEABLE_FRACTION * 100,
    )}% of fresh RAG input is repeated content eligible for the cache. The event stream carries no prompt text, so this cannot be measured from the data — treat it as an upper-bound estimate.`,
  };
}

/** All recommendations for a window, ranked by absolute monthly saving. */
export async function queryInsights(
  connection: DuckDBConnection,
  range: TimeRange,
  filters: MetricFilters,
  monthlyBurnUsd: number,
): Promise<Insight[]> {
  const windowHours = (range.toMs - range.fromMs) / 3600_000;
  const factor = monthlyFactor(windowHours);

  const routing = Object.entries(RECOMMENDED_DOWNGRADE) as [Endpoint, ModelId][];
  const results = await Promise.all([
    ...routing.map(([endpoint, target]) =>
      routingInsight(
        connection,
        endpoint,
        target,
        range,
        filters,
        factor,
        monthlyBurnUsd,
      ),
    ),
    cachingInsight(connection, range, filters, factor, monthlyBurnUsd),
  ]);

  return results
    .filter((i): i is Insight => i !== null)
    .sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);
}
