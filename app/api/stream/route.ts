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

/**
 * Serverless functions have a hard execution ceiling, so an SSE connection
 * cannot live forever. Rather than letting the platform sever it — which the
 * browser sees as a network failure — the stream retires itself just short of
 * the limit and tells the client it is a planned rotation.
 */
export const maxDuration = 60;

/** How often to recompute. Fast enough to feel live, slow enough to be cheap. */
const TICK_MS = 2_000;

/**
 * Comment frames keep intermediaries from closing an idle connection. Only sent
 * when a tick produced nothing to say.
 */
const HEARTBEAT_MS = 20_000;

/**
 * Close cleanly with headroom under `maxDuration`, so the goodbye frame is
 * always delivered before the platform pulls the plug.
 */
const MAX_LIFETIME_MS = 50_000;

export async function GET(req: NextRequest): Promise<Response> {
  const windowKey = parseWindowKey(req.nextUrl.searchParams.get("window"));
  const filters = parseFilters(req.nextUrl.searchParams);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
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

      // Retire before the platform's execution ceiling. The client reconnects
      // immediately and, because this is announced, does not report it as a
      // dropped connection.
      const lifetime = setTimeout(() => {
        if (closed) return;
        send("rotating", JSON.stringify({ reason: "max-duration" }));
        shutdown();
      }, MAX_LIFETIME_MS);
      lifetimeTimer = lifetime;

      await tick();
      timer = setInterval(tick, TICK_MS);
    },

    cancel() {
      if (timer) clearInterval(timer);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
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
