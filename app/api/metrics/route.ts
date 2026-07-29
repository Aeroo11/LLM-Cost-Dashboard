import { NextResponse, type NextRequest } from "next/server";
import { buildMetrics } from "@/lib/metrics-service";
import { parseFilters } from "@/lib/db/filters";
import { parseWindowKey, type MetricsResponse } from "@/lib/api-types";

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

export async function GET(req: NextRequest): Promise<NextResponse<MetricsResponse>> {
  const windowKey = parseWindowKey(req.nextUrl.searchParams.get("window"));
  const filters = parseFilters(req.nextUrl.searchParams);
  const payload = await buildMetrics(windowKey, filters);

  return NextResponse.json(payload, {
    headers: {
      // The payload is stable for the minute it is anchored to; letting a proxy
      // serve it for that long costs nothing and absorbs reload storms.
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
    },
  });
}
