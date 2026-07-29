import "server-only";

import {
  DuckDBConnection,
  DuckDBInstance,
  timestampValue,
} from "@duckdb/node-api";
import type { LLMRequest } from "../types";
import { MODELS } from "../models";
import { generateRange } from "../generator";
import { DB_PATH, RATE_PER_MIN, RETENTION_HOURS, SEED } from "../config";
import { DDL, VIEWS } from "./schema";

/**
 * The analytics store.
 *
 * Lifecycle:
 *
 *   1. **Backfill** — on first touch, generate `RETENTION_HOURS` of history and
 *      bulk-load it through DuckDB's appender.
 *   2. **Incremental ingest** — `refresh()` appends only the minutes that have
 *      elapsed since the last call and prunes past the retention horizon. This
 *      is what makes the dashboard genuinely live rather than a re-render of
 *      static data.
 *   3. **Query** — readers borrow their own connection; all aggregation is SQL.
 *
 * Step 2 is only correct because the generator is deterministic *per minute*
 * (see `seedForMinute`): appending minute-by-minute yields exactly the history
 * a single full backfill would have produced.
 *
 * Concurrency model — a DuckDB connection executes one statement at a time, and
 * the dashboard fans out several queries per request (plus an SSE stream that
 * polls continuously). So:
 *
 *   - Writes go through one dedicated connection, serialised behind a mutex.
 *     Two overlapping ingests would otherwise append the same minute twice.
 *   - Reads take a short-lived connection of their own. Connections are cheap;
 *     sharing one across concurrent requests serialises the whole server behind
 *     the slowest query.
 */
interface Store {
  instance: DuckDBInstance;
  /** Reserved for ingest and pruning. Never handed to query code. */
  writer: DuckDBConnection;
  /**
   * Exclusive upper bound of ingested data, to the millisecond.
   *
   * Not snapped to a minute: `generateRange` honours exact bounds, so ingest
   * runs in whatever slice of time has actually elapsed — a few seconds per
   * tick. That is what makes the stream visibly live instead of stepping once
   * a minute.
   */
  headMs: number;
}

/**
 * Next.js reloads modules on every edit in dev, which would otherwise rebuild
 * the store on each save. Stashing it on globalThis keeps one per process.
 */
const STORE_KEY = Symbol.for("tokenwatch.store");
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Promise<Store> };
const g = globalThis as GlobalWithStore;

async function bootstrap(connection: DuckDBConnection): Promise<void> {
  await connection.run(DDL);
  await connection.run(VIEWS);
  await connection.run("DELETE FROM models");
  for (const m of Object.values(MODELS)) {
    await connection.run("INSERT INTO models VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      m.id,
      m.label,
      m.vendor,
      m.tier,
      m.inputPer1M,
      m.outputPer1M,
      m.cachedInputPer1M,
      m.qualityBaseline,
      m.baseLatencyMs,
    ]);
  }
}

/**
 * Bulk-load through DuckDB's appender — the columnar fast path. Row-wise
 * INSERTs of ~54k events take tens of seconds; the appender takes ~200ms.
 */
async function appendRequests(
  connection: DuckDBConnection,
  rows: LLMRequest[],
): Promise<void> {
  if (rows.length === 0) return;

  const appender = await connection.createAppender("requests");
  try {
    for (const r of rows) {
      appender.appendVarchar(r.id);
      // DuckDB TIMESTAMP is microsecond-precision; our events are epoch ms.
      appender.appendTimestamp(timestampValue(BigInt(r.timestamp) * 1000n));
      appender.appendVarchar(r.model);
      appender.appendVarchar(r.endpoint);
      appender.appendInteger(r.inputTokens);
      appender.appendInteger(r.outputTokens);
      appender.appendInteger(r.cachedTokens);
      appender.appendInteger(r.latencyMs);
      appender.appendVarchar(r.status);
      appender.appendDouble(r.qualityScore);
      appender.appendDouble(r.costUsd);
      appender.endRow();
    }
    appender.flushSync();
  } finally {
    appender.closeSync();
  }
}

async function createStore(): Promise<Store> {
  const instance = await DuckDBInstance.create(DB_PATH);
  const writer = await instance.connect();
  await bootstrap(writer);

  // A persisted store may already hold history; only backfill what's missing.
  const existing = await writer.runAndReadAll(
    "SELECT CAST(coalesce(epoch_ms(max(ts)), 0) AS BIGINT) AS head FROM requests",
  );
  const persistedHead = Number(
    (existing.getRowObjects()[0]?.head as bigint | undefined) ?? 0n,
  );

  const now = Date.now();
  const horizon = now - RETENTION_HOURS * 3600_000;
  // Resume from just after the newest persisted event, unless the file is so
  // stale that everything in it has already aged out.
  const from = persistedHead > horizon ? persistedHead + 1 : horizon;

  await appendRequests(
    writer,
    generateRange({ from, to: now, ratePerMin: RATE_PER_MIN, seed: SEED }),
  );

  return { instance, writer, headMs: now };
}

/**
 * Serialises ingest. Every refresh chains onto the previous one, so overlapping
 * callers observe a single in-order sequence of appends rather than racing to
 * write the same minute. Errors are swallowed into the chain so one failed
 * refresh cannot poison every subsequent call.
 */
let ingestChain: Promise<void> = Promise.resolve();

function serialise(task: () => Promise<void>): Promise<void> {
  const run = ingestChain.then(task, task);
  ingestChain = run.catch(() => undefined);
  return run;
}

/**
 * Smallest slice of time worth an ingest round-trip. Below this the appender
 * overhead dominates and the UI cannot tell the difference anyway.
 */
const MIN_INGEST_MS = 1_000;

/** How often to prune, so the DELETE does not run on every tick. */
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneMs = 0;

/** Bring the store up to the current wall clock. Idempotent and cheap. */
async function refresh(store: Store): Promise<Store> {
  if (Date.now() - store.headMs < MIN_INGEST_MS) return store;

  await serialise(async () => {
    // Re-check inside the critical section: a queued caller may find the work
    // already done by the refresh it was waiting on.
    const now = Date.now();
    if (now - store.headMs < MIN_INGEST_MS) return;

    await appendRequests(
      store.writer,
      generateRange({
        from: store.headMs,
        to: now,
        ratePerMin: RATE_PER_MIN,
        seed: SEED,
      }),
    );
    store.headMs = now;

    if (now - lastPruneMs >= PRUNE_INTERVAL_MS) {
      await store.writer.run("DELETE FROM requests WHERE ts < epoch_ms($1::BIGINT)", [
        now - RETENTION_HOURS * 3600_000,
      ]);
      lastPruneMs = now;
    }
  });

  return store;
}

/**
 * Run a query against a store guaranteed to be current, on a connection of its
 * own. The in-flight bootstrap promise is memoised so concurrent cold-start
 * requests share one backfill instead of racing to build several.
 */
export async function withConnection<T>(
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  if (!g[STORE_KEY]) g[STORE_KEY] = createStore();
  const store = await refresh(await g[STORE_KEY]);

  const connection = await store.instance.connect();
  try {
    return await fn(connection);
  } finally {
    connection.closeSync();
  }
}

/** Epoch ms of the newest ingested minute — the stream's "as of" marker. */
export async function storeHeadMs(): Promise<number> {
  if (!g[STORE_KEY]) g[STORE_KEY] = createStore();
  const store = await refresh(await g[STORE_KEY]);
  return store.headMs;
}

/** Test/CLI helper: an isolated in-memory store over a fixed range. */
export async function createTestStore(
  from: number,
  to: number,
  opts: { ratePerMin?: number; seed?: number } = {},
): Promise<{ instance: DuckDBInstance; connection: DuckDBConnection }> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await bootstrap(connection);
  await appendRequests(
    connection,
    generateRange({
      from,
      to,
      ratePerMin: opts.ratePerMin ?? RATE_PER_MIN,
      seed: opts.seed ?? SEED,
    }),
  );
  return { instance, connection };
}

/**
 * Number of events ingested since a given timestamp — the cheap "is there
 * anything new?" check the stream uses before recomputing a payload.
 */
export async function countSince(sinceMs: number): Promise<number> {
  return withConnection(async (connection) => {
    const reader = await connection.runAndReadAll(
      "SELECT count(*) AS n FROM requests WHERE ts >= epoch_ms($1::BIGINT)",
      [sinceMs],
    );
    return Number(reader.getRowObjects()[0]?.n ?? 0);
  });
}
