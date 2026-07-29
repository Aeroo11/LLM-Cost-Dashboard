import type { NextRequest } from "next/server";
import { buildMetrics, metricsFingerprint } from "@/lib/metrics-service";
import { parseFilters } from "@/lib/db/filters";
import { parseWindowKey } from "@/lib/api-types";

/**
 * `GET /api/stream?window=24h&model=…` — Server-Sent Events.
 *
 * The dashboard used to poll every 5 seconds and label itself "live" while
 * showing data that only changed once a minute; eleven of every twelve polls
 * returned identical bytes. This pushes instead: the store ingests continuously
 * and a new payload goes out as soon as there is one.
 *
 * SSE rather than WebSockets because the traffic is strictly one-way. It also
 * survives proxies as ordinary HTTP and reconnects on its own.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How often to recompute. Fast enough to feel live, slow enough to be cheap. */
const TICK_MS = 2_000;

/**
 * Comment frames keep intermediaries from closing an idle connection. Only sent
 * when a tick produced nothing to say.
 */
const HEARTBEAT_MS = 20_000;

export async function GET(req: NextRequest): Promise<Response> {
  const windowKey = parseWindowKey(req.nextUrl.searchParams.get("window"));
  const filters = parseFilters(req.nextUrl.searchParams);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastFingerprint = "";
      let lastHeartbeat = Date.now();
      let inFlight = false;

      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      };

      // The browser reconnects on its own, but tell it how long to wait first.
      controller.enqueue(encoder.encode(`retry: 3000\n\n`));

      const tick = async () => {
        // A slow recompute must not queue up behind itself and pile on load.
        if (closed || inFlight) return;
        inFlight = true;
        try {
          const payload = await buildMetrics(windowKey, filters);
          const fingerprint = metricsFingerprint(payload);

          // Traffic averages a handful of events per minute, so plenty of ticks
          // genuinely have nothing new. Sending only on change avoids the exact
          // flaw of the polling version this replaces: eleven of every twelve
          // responses being byte-identical.
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            lastHeartbeat = Date.now();
            send("metrics", JSON.stringify(payload));
          } else if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          }
        } catch (err) {
          send(
            "stream-error",
            JSON.stringify({ message: (err as Error).message ?? "unknown error" }),
          );
          shutdown();
        } finally {
          inFlight = false;
        }
      };

      // Client navigated away, reloaded, or lost the connection.
      req.signal.addEventListener("abort", shutdown);

      await tick();
      timer = setInterval(tick, TICK_MS);
    },

    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies from buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
