import { NextResponse } from "next/server";
import { requireIdentity } from "../cursor/identity";
import { checkRateLimit } from "./rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Require a signed-in Cursor viewer (private/team) and enforce a tight
 * per-visitor rate limit before spending Bright Data quota.
 */
export async function protectBrightDataRoute(
  request: Request,
  routeName: "search" | "product" | "compare",
): Promise<Response | { visitorId: string }> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return NextResponse.json(
      {
        error: "Sign in required to search and compare prices.",
        code: "unauthorized",
      },
      { status: 401, headers: NO_STORE },
    );
  }

  // Prefer person viewers; API keys still get a stable sub for quotas.
  const visitorId = identity.sub;
  const limited = checkRateLimit(`${routeName}:${visitorId}`);
  if (!limited.ok) {
    const message =
      limited.reason === "daily"
        ? "Daily search limit reached for this account. Try again tomorrow."
        : "Too many requests. Wait a minute and try again.";
    return NextResponse.json(
      { error: message, code: "rate_limited", reason: limited.reason },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(limited.retryAfterSec),
        },
      },
    );
  }

  return { visitorId };
}

export function jsonPrivate(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: NO_STORE,
  });
}
