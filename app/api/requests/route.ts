import { NextResponse, type NextRequest } from "next/server";
import { withConnection } from "@/lib/db/client";
import { queryRequests, type RequestPage, type RequestSortKey } from "@/lib/db/queries";
import { parseFilters } from "@/lib/db/filters";
import { currentRange } from "@/lib/metrics-service";
import { parseWindowKey } from "@/lib/api-types";

/**
 * `GET /api/requests` — the raw events behind the charts.
 *
 * Aggregates are only trustworthy if you can get to the rows underneath them,
 * so the drill-down table reads the same fact table the KPIs are computed from.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORT_KEYS: RequestSortKey[] = ["ts", "cost_usd", "latency_ms", "input_tokens"];

function parseSort(raw: string | null): RequestSortKey {
  return SORT_KEYS.includes(raw as RequestSortKey) ? (raw as RequestSortKey) : "ts";
}

function parseInt10(raw: string | null, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest): Promise<NextResponse<RequestPage>> {
  const params = req.nextUrl.searchParams;
  const windowKey = parseWindowKey(params.get("window"));
  const filters = parseFilters(params);
  const range = currentRange(windowKey);

  const page = await withConnection((connection) =>
    queryRequests(connection, range, filters, {
      sort: parseSort(params.get("sort")),
      direction: params.get("dir") === "asc" ? "asc" : "desc",
      // queryRequests clamps these; parsing here only keeps NaN out.
      limit: parseInt10(params.get("limit"), 25),
      offset: parseInt10(params.get("offset"), 0),
    }),
  );

  return NextResponse.json(page, {
    headers: { "Cache-Control": "no-store" },
  });
}
