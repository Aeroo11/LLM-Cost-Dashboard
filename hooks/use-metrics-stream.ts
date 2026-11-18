"use client";

import { useEffect, useRef, useState } from "react";
import type { MetricsResponse } from "@/lib/api-types";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "error";

export interface StreamResult {
  data: MetricsResponse | null;
  status: ConnectionState;
  /**
   * True when `data` belongs to a previous query — the window or filters
   * changed and the first frame for the new one has not landed yet.
   *
   * The frame is deliberately held rather than cleared: swapping a rendered
   * dashboard for a skeleton on every filter click is a flash and a layout
   * jump. Callers dim the held frame instead.
   */
  stale: boolean;
  /** Wall-clock time the last frame arrived, for the "updated Xs ago" label. */
  lastUpdateMs: number | null;
  error: string | null;
}

/**
 * Subscribe to `/api/stream` over Server-Sent Events.
 *
 * This replaces a `setInterval` that re-fetched every 5 seconds regardless of
 * whether anything had changed. Beyond the wasted requests, that pattern also
 * trips React's `set-state-in-effect` rule for good reason — the effect body
 * kicked off work that synchronously set state. An EventSource subscription is
 * the shape the rule actually wants: subscribe to an external system, set state
 * from its callbacks, tear it down on cleanup.
 *
 * Reconnection is left to the browser, which honours the `retry:` interval the
 * server sends and backs off on repeated failures.
 */
export function useMetricsStream(queryString: string): StreamResult {
  // The frame carries the query it answered, so "is this still current?" is a
  // comparison rather than another piece of state to keep in sync.
  const [frame, setFrame] = useState<{
    key: string;
    data: MetricsResponse;
  } | null>(null);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Distinguishes a first connection from a dropped one, so the UI can say
  // "reconnecting" instead of flashing back to "connecting".
  const hasConnected = useRef(false);
  // Set when the server announces it is retiring the connection at its
  // execution ceiling. The reconnect that follows is routine, not a fault, so
  // the indicator must not flash "reconnecting" every time it happens.
  const rotating = useRef(false);

  useEffect(() => {
    const source = new EventSource(`/api/stream?${queryString}`);

    const onMetrics = (event: MessageEvent<string>) => {
      try {
        setFrame({
          key: queryString,
          data: JSON.parse(event.data) as MetricsResponse,
        });
        setLastUpdateMs(Date.now());
        setStatus("live");
        setError(null);
        hasConnected.current = true;
        rotating.current = false;
      } catch {
        setError("Received a malformed frame from the stream.");
        setStatus("error");
      }
    };

    const onStreamError = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { message?: string };
        setError(parsed.message ?? "The stream reported an error.");
      } catch {
        setError("The stream reported an error.");
      }
      setStatus("error");
    };

    // The server hit its execution ceiling and is handing over to a fresh
    // connection. Nothing is wrong, so hold the "live" state across the gap.
    const onRotating = () => {
      rotating.current = true;
    };

    // Fired on network drops too, where the browser will retry on its own.
    const onError = () => {
      if (rotating.current) return; // announced hand-over, not a fault
      setStatus(hasConnected.current ? "reconnecting" : "connecting");
    };

    source.addEventListener("metrics", onMetrics as EventListener);
    source.addEventListener("stream-error", onStreamError as EventListener);
    source.addEventListener("rotating", onRotating);
    source.addEventListener("error", onError);

    return () => {
      source.removeEventListener("metrics", onMetrics as EventListener);
      source.removeEventListener("stream-error", onStreamError as EventListener);
      source.removeEventListener("rotating", onRotating);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [queryString]);

  return {
    data: frame?.data ?? null,
    stale: frame != null && frame.key !== queryString,
    status,
    lastUpdateMs,
    error,
  };
}
