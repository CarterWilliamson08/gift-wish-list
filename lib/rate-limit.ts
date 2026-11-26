/** In-memory per-visitor caps for household Bright Data use. */

type Bucket = {
  windowStart: number;
  windowCount: number;
  dayKey: string;
  dayCount: number;
};

const buckets = new Map<string, Bucket>();

/** Small burst + daily cap suitable for one household. */
export const RATE = {
  windowMs: 60_000,
  windowMax: 8,
  dayMax: 40,
} as const;

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type RateLimitResult =
  | { ok: true; remainingWindow: number; remainingDay: number }
  | { ok: false; reason: "burst" | "daily"; retryAfterSec: number };

export function checkRateLimit(visitorKey: string): RateLimitResult {
  const now = Date.now();
  const today = dayKey(now);
  let bucket = buckets.get(visitorKey);

  if (!bucket || bucket.dayKey !== today) {
    bucket = {
      windowStart: now,
      windowCount: 0,
      dayKey: today,
      dayCount: 0,
    };
  }

  if (now - bucket.windowStart >= RATE.windowMs) {
    bucket.windowStart = now;
    bucket.windowCount = 0;
  }

  if (bucket.dayCount >= RATE.dayMax) {
    buckets.set(visitorKey, bucket);
    const endOfDay = Date.parse(`${today}T23:59:59.999Z`) + 1;
    return {
      ok: false,
      reason: "daily",
      retryAfterSec: Math.max(1, Math.ceil((endOfDay - now) / 1000)),
    };
  }

  if (bucket.windowCount >= RATE.windowMax) {
    buckets.set(visitorKey, bucket);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((bucket.windowStart + RATE.windowMs - now) / 1000),
    );
    return { ok: false, reason: "burst", retryAfterSec };
  }

  bucket.windowCount += 1;
  bucket.dayCount += 1;
  buckets.set(visitorKey, bucket);

  return {
    ok: true,
    remainingWindow: RATE.windowMax - bucket.windowCount,
    remainingDay: RATE.dayMax - bucket.dayCount,
  };
}
