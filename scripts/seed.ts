/**
 * Build a persistent DuckDB file from the simulated event stream.
 *
 *   npm run seed -- --hours 168 --out data/events.duckdb
 *
 * The dashboard itself does not need this: it backfills an in-memory store on
 * boot. The file matters for the other half of the story — once it exists you
 * can point the DuckDB CLI, a notebook, or any BI tool at the same fact table
 * the app queries and check the numbers independently.
 *
 * Runs under `tsx`, which honours the same tsconfig path aliases the app uses.
 */

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, timestampValue } from "@duckdb/node-api";
import { generateRange, MINUTE_MS } from "@/lib/generator";
import { MODELS } from "@/lib/models";
import { DDL, VIEWS } from "@/lib/db/schema";
import { RATE_PER_MIN, SEED } from "@/lib/config";

interface Args {
  hours: number;
  out: string;
  ratePerMin: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    hours: Number(get("hours", "168")),
    out: get("out", path.join("data", "events.duckdb")),
    ratePerMin: Number(get("rate", String(RATE_PER_MIN))),
    seed: Number(get("seed", String(SEED))),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const to = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const from = to - args.hours * 3600_000;

  console.log(
    `Generating ${args.hours}h of events @ ~${args.ratePerMin}/min (seed ${args.seed})…`,
  );
  const started = Date.now();
  const events = generateRange({
    from,
    to,
    ratePerMin: args.ratePerMin,
    seed: args.seed,
  });
  console.log(`  ${events.length.toLocaleString()} events in ${Date.now() - started}ms`);

  await mkdir(path.dirname(args.out), { recursive: true });
  // DuckDB refuses to open a file written by a different version, and a stale
  // file would silently mix old and new events. Start clean every time.
  await rm(args.out, { force: true });
  await rm(`${args.out}.wal`, { force: true });

  const instance = await DuckDBInstance.create(args.out);
  const connection = await instance.connect();
  await connection.run(DDL);
  await connection.run(VIEWS);

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

  const loadStart = Date.now();
  const appender = await connection.createAppender("requests");
  for (const r of events) {
    appender.appendVarchar(r.id);
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
  appender.closeSync();
  console.log(`  loaded in ${Date.now() - loadStart}ms`);

  const summary = await connection.runAndReadAll(/* sql */ `
    SELECT
      count(*)                                   AS events,
      round(sum(cost_usd), 2)                    AS total_usd,
      count(DISTINCT model)                      AS models,
      strftime(min(ts), '%Y-%m-%d %H:%M')        AS first_event,
      strftime(max(ts), '%Y-%m-%d %H:%M')        AS last_event
    FROM requests
  `);

  console.table(
    summary
      .getRowObjects()
      .map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
        ),
      ),
  );

  connection.closeSync();
  instance.closeSync();
  console.log(`\nWrote ${args.out}`);
  console.log(`Explore it with:  duckdb ${args.out} -c "SELECT * FROM v_requests LIMIT 5"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
