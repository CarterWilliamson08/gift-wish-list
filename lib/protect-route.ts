import { NextResponse } from "next/server";
import { getIdentity } from "../cursor/identity";
import { checkRateLimit } from "./rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return "unknown";
}

/**
 * Soft Cursor identity when present (private/team), otherwise per-IP visitor
 * key. Never blocks anonymous callers with "sign in required" — public apps
 * have no sign-in UI. Always enforce Bright Data rate limits.
 */
export async function protectBrightDataRoute(
  request: Request,
  routeName: "search" | "product" | "compare",
): Promise<Response | { visitorId: string }> {
  const identity = await getIdentity(request);
  const visitorId = identity.verified
    ? `id:${identity.sub}`
    : `ip:${clientIp(request)}`;

  const limited = checkRateLimit(`${routeName}:${visitorId}`);
  if (!limited.ok) {
    const message =
      limited.reason === "daily"
        ? "Daily search limit reached. Try again tomorrow."
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
