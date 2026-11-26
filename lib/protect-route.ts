import { NextResponse } from "next/server";
import { getIdentity } from "../cursor/identity";
import { checkRateLimit } from "./rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const VISITOR_COOKIE = "wl_vid";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ProtectOk = {
  visitorId: string;
  /** Extra response headers (e.g. Set-Cookie for a new visitor id). */
  extraHeaders: Record<string, string>;
};

function readVisitorCookie(request: Request): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VISITOR_COOKIE) {
      const value = rest.join("=").trim();
      if (/^[a-zA-Z0-9_-]{16,64}$/.test(value)) return value;
    }
  }
  return null;
}

function mintVisitorId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function visitorSetCookie(id: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VISITOR_COOKIE_MAX_AGE}${secure}`;
}

/**
 * Soft Cursor identity when present; otherwise a server-minted HttpOnly
 * visitor cookie (never client-supplied IP / X-Forwarded-For). Always
 * enforce per-visitor + global Bright Data rate limits.
 */
export async function protectBrightDataRoute(
  request: Request,
  routeName: "search" | "product" | "compare",
): Promise<Response | ProtectOk> {
  const identity = await getIdentity(request);
  const extraHeaders: Record<string, string> = {};

  let visitorId: string;
  if (identity.verified) {
    visitorId = `id:${identity.sub}`;
  } else {
    const existing = readVisitorCookie(request);
    if (existing) {
      visitorId = `ck:${existing}`;
    } else {
      const minted = mintVisitorId();
      visitorId = `ck:${minted}`;
      extraHeaders["Set-Cookie"] = visitorSetCookie(minted, request);
    }
  }

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
          ...extraHeaders,
        },
      },
    );
  }

  return { visitorId, extraHeaders };
}

export function jsonPrivate(
  data: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { ...NO_STORE, ...init?.headers },
  });
}
