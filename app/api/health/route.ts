import { NextResponse, type NextRequest } from "next/server";
import { withErrorReporting } from "@/lib/api-error";

/**
 * `GET /api/health` — does the store actually work in this environment?
 *
 * Added after a deployment failed with nothing to debug but an opaque HTML 500.
 * Each stage is reported separately, so a failure says *which* one broke rather
 * than just that something did: whether the native binding loads at all,
 * whether an instance can be created under the configured settings, and whether
 * a query returns.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Stage {
  stage: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export function GET(_req: NextRequest) {
  return withErrorReporting(async () => {
    const stages: Stage[] = [];
    const run = async (stage: string, fn: () => Promise<string | undefined>) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        stages.push({ stage, ok: true, ms: Date.now() - t0, detail });
        return true;
      } catch (err) {
        stages.push({
          stage,
          ok: false,
          ms: Date.now() - t0,
          detail: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    };

    const env = {
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      vercel: process.env.VERCEL === "1",
      region: process.env.VERCEL_REGION ?? null,
      cwd: process.cwd(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };

    // Stage 1: can the native addon be resolved and loaded at all?
    let duckdb: typeof import("@duckdb/node-api") | undefined;
    const loaded = await run("load-native-binding", async () => {
      duckdb = await import("@duckdb/node-api");
      return typeof duckdb.DuckDBInstance === "function"
        ? "binding loaded"
        : "module loaded but DuckDBInstance is missing";
    });

    // Stage 2: can an instance be created under the configured settings?
    if (loaded && duckdb) {
      const { DUCKDB_SETTINGS } = await import("@/lib/config");
      await run("create-instance", async () => {
        const instance = await duckdb!.DuckDBInstance.create(
          ":memory:",
          DUCKDB_SETTINGS,
        );
        const connection = await instance.connect();
        const reader = await connection.runAndReadAll(
          "SELECT version() AS v, current_setting('temp_directory') AS tmp, current_setting('memory_limit') AS mem",
        );
        const row = reader.getRowObjects()[0];
        connection.closeSync();
        instance.closeSync();
        return `duckdb ${row.v}, temp=${row.tmp}, memory=${row.mem}`;
      });

      // Stage 3: does the real store build and answer a query?
      await run("build-store", async () => {
        const { withConnection } = await import("@/lib/db/client");
        return withConnection(async (connection) => {
          const reader = await connection.runAndReadAll(
            "SELECT count(*) AS n FROM requests",
          );
          return `${Number(reader.getRowObjects()[0].n).toLocaleString()} events ingested`;
        });
      });
    }

    const ok = stages.every((s) => s.ok);
    return NextResponse.json(
      { ok, env, stages },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  });
}
