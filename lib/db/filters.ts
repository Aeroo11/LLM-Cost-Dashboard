import type { Endpoint, ModelId, RequestStatus } from "../types";
import { MODEL_IDS } from "../models";

export const ENDPOINT_IDS: Endpoint[] = ["chat", "classify", "summarize", "rag"];
export const STATUS_IDS: RequestStatus[] = [
  "success",
  "error",
  "rate_limited",
  "timeout",
];

/** An empty array means "no filter on this dimension", not "match nothing". */
export interface MetricFilters {
  models: ModelId[];
  endpoints: Endpoint[];
  statuses: RequestStatus[];
}

export const NO_FILTERS: MetricFilters = {
  models: [],
  endpoints: [],
  statuses: [],
};

export interface TimeRange {
  /** Inclusive lower bound, epoch ms. */
  fromMs: number;
  /** Exclusive upper bound, epoch ms. */
  toMs: number;
}

/**
 * Keep only values that are in the known set. Filters arrive from the query
 * string, so this is the trust boundary: anything unrecognised is dropped
 * rather than reaching the database.
 */
function keepKnown<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const set = new Set<string>(allowed);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    if (set.has(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as T);
    }
  }
  return out;
}

/** Parse `?model=a,b&endpoint=chat&status=error` into validated filters. */
export function parseFilters(params: URLSearchParams): MetricFilters {
  const split = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    models: keepKnown(split("model"), MODEL_IDS),
    endpoints: keepKnown(split("endpoint"), ENDPOINT_IDS),
    statuses: keepKnown(split("status"), STATUS_IDS),
  };
}

/**
 * Everything this layer binds is a bare scalar. Narrowing the type here (rather
 * than using DuckDB's full `DuckDBValue` union) keeps this module free of any
 * runtime dependency on the driver, so client code can import `parseFilters`
 * and `serialiseFilters` without dragging a native addon into the bundle.
 */
export type SqlParam = string | number;

export interface Predicate {
  /** SQL fragment beginning with the time bounds; always non-empty. */
  sql: string;
  params: SqlParam[];
}

/**
 * Build the shared WHERE clause. Values are bound as positional parameters —
 * the filter values are whitelisted above, but binding them keeps the query
 * plan cacheable and means no user-derived text is ever concatenated into SQL.
 */
export function buildPredicate(
  range: TimeRange,
  filters: MetricFilters,
  startIndex = 1,
): Predicate {
  const params: SqlParam[] = [range.fromMs, range.toMs];
  let next = startIndex + 2;
  const clauses = [
    `ts >= epoch_ms($${startIndex}::BIGINT)`,
    `ts < epoch_ms($${startIndex + 1}::BIGINT)`,
  ];

  const addIn = (column: string, values: string[]) => {
    if (values.length === 0) return;
    const placeholders = values.map(() => `$${next++}`).join(", ");
    clauses.push(`${column} IN (${placeholders})`);
    params.push(...values);
  };

  addIn("model", filters.models);
  addIn("endpoint", filters.endpoints);
  addIn("status", filters.statuses);

  return { sql: clauses.join(" AND "), params };
}

/** Serialise filters back into a query string (for URL state + SSE reconnects). */
export function serialiseFilters(filters: MetricFilters): string {
  const params = new URLSearchParams();
  if (filters.models.length) params.set("model", filters.models.join(","));
  if (filters.endpoints.length) params.set("endpoint", filters.endpoints.join(","));
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  return params.toString();
}

export function hasAnyFilter(filters: MetricFilters): boolean {
  return (
    filters.models.length > 0 ||
    filters.endpoints.length > 0 ||
    filters.statuses.length > 0
  );
}
