import os from "node:os";
import path from "node:path";

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

/**
 * DuckDB settings, pinned for serverless.
 *
 * Every default below is derived by DuckDB from the *host machine*, which is
 * exactly wrong inside a function container:
 *
 *   temp_directory  defaults to the relative path ".tmp", resolved against the
 *                   working directory. On Vercel that is /var/task, which is
 *                   read-only — DuckDB throws the moment it needs to spill.
 *   memory_limit    defaults to ~80% of detected system RAM (25 GiB on the dev
 *                   machine). A function with 1 GB that believes it has 25 will
 *                   over-commit and get OOM-killed.
 *   threads         defaults to the host core count (20 locally) against the
 *                   ~2 vCPU a function actually gets.
 *   extensions      autoload/autoinstall would try to download extensions and
 *                   write them under $HOME at query time. Nothing here uses an
 *                   extension, so both are turned off rather than left to fail.
 *
 * The workload is small — a 7-day window is ~54k rows, a few MB — so the caps
 * below are generous for it while staying inside a function's real budget.
 */
export const DUCKDB_SETTINGS: Record<string, string> = {
  // os.tmpdir() is /tmp on Lambda — the one writable path — and the platform
  // temp directory everywhere else.
  temp_directory:
    process.env.DUCKDB_TEMP_DIR ?? path.join(os.tmpdir(), "tokenwatch-duckdb"),
  memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "512MB",
  threads: process.env.DUCKDB_THREADS ?? "2",
  autoinstall_known_extensions: "false",
  autoload_known_extensions: "false",
};
