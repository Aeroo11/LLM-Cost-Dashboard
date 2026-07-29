import { NextResponse } from "next/server";

/**
 * Turn a thrown error into a JSON response instead of an opaque 500.
 *
 * A route that throws gets Next's generic "A server error occurred" HTML page.
 * That is the right default for an app handling user data, and the wrong one
 * here: this demo holds no secrets, and the first deployment failed with
 * nothing to go on but a 500 and a stack trace only the project owner could
 * read. Surfacing the message makes the API self-diagnosing.
 *
 * The stack is included only outside production, so a public deployment
 * reports *what* broke without publishing its internals.
 */
export interface ApiError {
  error: string;
  message: string;
  stack?: string;
}

export function withErrorReporting<T>(
  handler: () => Promise<NextResponse<T>>,
): Promise<NextResponse<T | ApiError>> {
  return handler().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    // Still log it — Vercel's function logs remain the fuller record.
    console.error("[api] request failed:", e);

    return NextResponse.json<ApiError>(
      {
        error: e.name || "Error",
        message: e.message || "Unknown error",
        ...(process.env.NODE_ENV === "production" ? {} : { stack: e.stack }),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  });
}
