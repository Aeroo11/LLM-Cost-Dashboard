import { NextResponse, type NextRequest } from "next/server";
import { buildMetrics } from "@/lib/metrics-service";
import { parseFilters } from "@/lib/db/filters";
import { parseWindowKey, type MetricsResponse } from "@/lib/api-types";
import { withErrorReporting } from "@/lib/api-error";

/**
 * `GET /api/metrics?window=24h&model=gpt-4o&endpoint=rag&status=success`
 *
 * The window slides with wall-clock time and the store ingests continuously, so
 * this can never be statically rendered. It is snapshot-shaped: the live path is
 * `/api/stream`, which pushes this same payload as the data changes.
 */
export const dynamic = "force-dynamic";

// DuckDB's native addon rules out the edge runtime.
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return withErrorReporting<MetricsResponse>(async () => {
    const windowKey = parseWindowKey(req.nextUrl.searchParams.get("window"));
    const filters = parseFilters(req.nextUrl.searchParams);
    const payload = await buildMetrics(windowKey, filters);

    return NextResponse.json(payload, {
      headers: {
        // The payload changes as events arrive, so a shared cache would serve
        // a stale window. The live path is /api/stream; this is the snapshot.
        "Cache-Control": "no-store",
      },
    });
  });
}
