/**
 * Simulation and store configuration.
 *
 * These were previously hard-coded inside the API route. They live here — and
 * read from the environment — so the same build can be demoed at "startup
 * traffic" or "scale-up traffic" without a code change.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Base PRNG seed. Same seed ⇒ same history, so demos are reproducible. */
export const SEED = envInt("SIM_SEED", 42);

/** Average requests per minute before the diurnal curve is applied. */
export const RATE_PER_MIN = envInt("SIM_RATE_PER_MIN", 8);

/**
 * How much history the store holds. Must be ≥ the largest selectable window,
 * since anything older is pruned on every refresh.
 */
export const RETENTION_HOURS = envInt("SIM_RETENTION_HOURS", 168);

/** Path to the persisted DuckDB file, or ":memory:" for an ephemeral store. */
export const DB_PATH = process.env.DUCKDB_PATH ?? ":memory:";
