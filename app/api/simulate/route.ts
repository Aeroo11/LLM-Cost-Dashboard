import { NextResponse, type NextRequest } from "next/server";
import { withConnection } from "@/lib/db/client";
import { parseScenario, simulate, type ScenarioResult } from "@/lib/db/simulate";
import { parseFilters } from "@/lib/db/filters";
import { currentRange } from "@/lib/metrics-service";
import { parseWindowKey } from "@/lib/api-types";
import { withErrorReporting } from "@/lib/api-error";

/**
 * `POST /api/simulate` — re-price the observed window under a hypothetical
 * configuration.
 *
 * POST rather than GET because the scenario is a structured body, and because
 * it must never be cached: the answer depends on traffic that is still arriving.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return withErrorReporting<ScenarioResult | { error: string }>(async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Body must be valid JSON." },
        { status: 400 },
      );
    }

    const params = req.nextUrl.searchParams;
    const windowKey = parseWindowKey(params.get("window"));
    const filters = parseFilters(params);
    // Every field is clamped and whitelisted; nothing from the body reaches SQL
    // except as a bound parameter.
    const scenario = parseScenario(body);

    const result = await withConnection((connection) =>
      simulate(connection, currentRange(windowKey), filters, scenario),
    );

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
