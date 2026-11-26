/** In-memory caps for household Bright Data use (per visitor + global). */

type Bucket = {
  windowStart: number;
  windowCount: number;
  dayKey: string;
  dayCount: number;
  lastTouch: number;
};

const buckets = new Map<string, Bucket>();

/** Per-visitor burst + daily cap. */
export const RATE = {
  windowMs: 60_000,
  windowMax: 8,
  dayMax: 40,
} as const;

/** Process-wide cap so rotating visitor cookies cannot unbound spend. */
export const GLOBAL_RATE = {
  windowMs: 60_000,
  windowMax: 24,
  dayMax: 120,
} as const;

const GLOBAL_KEY = "global:brightdata";
const MAX_BUCKETS = 500;

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function pruneBuckets(now: number) {
  const today = dayKey(now);
  for (const [key, bucket] of buckets) {
    if (key === GLOBAL_KEY) continue;
    const staleDay = bucket.dayKey !== today;
    const staleTouch = now - bucket.lastTouch > 48 * 60 * 60 * 1000;
    if (staleDay || staleTouch) buckets.delete(key);
  }
  if (buckets.size <= MAX_BUCKETS) return;
  const oldest = [...buckets.entries()]
    .filter(([k]) => k !== GLOBAL_KEY)
    .sort((a, b) => a[1].lastTouch - b[1].lastTouch);
  for (const [key] of oldest) {
    if (buckets.size <= MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export type RateLimitResult =
  | { ok: true; remainingWindow: number; remainingDay: number }
  | { ok: false; reason: "burst" | "daily"; retryAfterSec: number };

function checkBucket(
  key: string,
  limits: { windowMs: number; windowMax: number; dayMax: number },
  now: number,
): RateLimitResult {
  const today = dayKey(now);
  let bucket = buckets.get(key);

  if (!bucket || bucket.dayKey !== today) {
    bucket = {
      windowStart: now,
      windowCount: 0,
      dayKey: today,
      dayCount: 0,
      lastTouch: now,
    };
  }

  if (now - bucket.windowStart >= limits.windowMs) {
    bucket.windowStart = now;
    bucket.windowCount = 0;
  }

  if (bucket.dayCount >= limits.dayMax) {
    bucket.lastTouch = now;
    buckets.set(key, bucket);
    const endOfDay = Date.parse(`${today}T23:59:59.999Z`) + 1;
    return {
      ok: false,
      reason: "daily",
      retryAfterSec: Math.max(1, Math.ceil((endOfDay - now) / 1000)),
    };
  }

  if (bucket.windowCount >= limits.windowMax) {
    bucket.lastTouch = now;
    buckets.set(key, bucket);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((bucket.windowStart + limits.windowMs - now) / 1000),
    );
    return { ok: false, reason: "burst", retryAfterSec };
  }

  bucket.windowCount += 1;
  bucket.dayCount += 1;
  bucket.lastTouch = now;
  buckets.set(key, bucket);

  return {
    ok: true,
    remainingWindow: limits.windowMax - bucket.windowCount,
    remainingDay: limits.dayMax - bucket.dayCount,
  };
}

/** Per-visitor limit, then global limit. Both must pass. */
export function checkRateLimit(visitorKey: string): RateLimitResult {
  const now = Date.now();
  pruneBuckets(now);

  const visitor = checkBucket(visitorKey, RATE, now);
  if (!visitor.ok) return visitor;

  const global = checkBucket(GLOBAL_KEY, GLOBAL_RATE, now);
  if (!global.ok) return global;

  return visitor;
}
