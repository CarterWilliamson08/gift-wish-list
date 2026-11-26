import type { ProductHit, RetailerOffer } from "./types";

export const DATASETS = {
  amazonSearch: "gd_lwdb4vjm1ehb499uxs",
  amazonProduct: "gd_l7q7dkf244hwjntr0",
  googleShopping: "gd_ltppk50q18kdw67omz",
} as const;

const API_BASE = "https://api.brightdata.com/datasets/v3";

/** Hosting kills hung routes around ~30s; keep scrape work under that. */
export const SEARCH_BUDGET_MS = 22_000;
export const ENRICH_BUDGET_MS = 8_000;
const POLL_INTERVAL_MS = 2_000;
const FETCH_TIMEOUT_MS = 12_000;

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function getApiKey(): string | undefined {
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  return key || undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    // Empty / non-numeric strings (e.g. "See price in cart") must stay null — never coerce to 0.
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Amazon search often returns final_price/initial_price = 0 when the listing has no
 * buy-box / cart price. Treat non-positive values as unknown rather than $0.00.
 */
function asPositivePrice(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null || n <= 0) return null;
  return n;
}

/** Prefer live buy-box / final price fields; skip sentinel zeros. */
export function pickAmazonPrice(row: Record<string, unknown>): number | null {
  const buybox = row.buybox_prices;
  const buyboxFinal =
    buybox && typeof buybox === "object"
      ? asPositivePrice((buybox as Record<string, unknown>).final_price) ??
        asPositivePrice((buybox as Record<string, unknown>).price)
      : null;

  return (
    asPositivePrice(row.final_price) ??
    buyboxFinal ??
    asPositivePrice(row.current_price) ??
    asPositivePrice(row.price) ??
    asPositivePrice(row.list_price) ??
    asPositivePrice(row.initial_price)
  );
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** Only allow http(s) absolute URLs — drop javascript:/data:/etc. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function pickImage(row: Record<string, unknown>): string | null {
  return safeHttpUrl(
    asString(row.image) ||
      asString(row.image_url) ||
      asString(row.main_image) ||
      (Array.isArray(row.images) ? asString(row.images[0]) : null),
  );
}

export function mapAmazonSearchRow(row: Record<string, unknown>): ProductHit | null {
  const title =
    asString(row.name) || asString(row.title) || asString(row.product_name);
  const url = safeHttpUrl(asString(row.url));
  if (!title || !url) return null;
  const asin = asString(row.asin);
  return {
    id: asin || url,
    title,
    price: pickAmazonPrice(row),
    currency: asString(row.currency) || "USD",
    url,
    image: pickImage(row),
    retailer: "Amazon",
    asin,
  };
}

export function mapAmazonProductRow(row: Record<string, unknown>): ProductHit | null {
  const title = asString(row.title) || asString(row.name);
  const url = safeHttpUrl(asString(row.url) || asString(row.input_url));
  if (!title || !url) return null;
  const asin = asString(row.asin);
  return {
    id: asin || url,
    title,
    price: pickAmazonPrice(row),
    currency: asString(row.currency) || "USD",
    url,
    image: pickImage(row),
    retailer: "Amazon",
    asin,
  };
}

function retailerFromUrl(url: string, fallback?: string | null): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("amazon.")) return "Amazon";
    if (host.includes("walmart.")) return "Walmart";
    if (host.includes("bestbuy.")) return "Best Buy";
    if (host.includes("target.")) return "Target";
    if (host.includes("ebay.")) return "eBay";
    return fallback || host.split(".")[0] || "Retailer";
  } catch {
    return fallback || "Retailer";
  }
}

export function mapShoppingRows(rows: Record<string, unknown>[]): RetailerOffer[] {
  const offers: RetailerOffer[] = [];

  for (const row of rows) {
    const buying = row.buying_options;
    if (Array.isArray(buying)) {
      for (const opt of buying) {
        if (!opt || typeof opt !== "object") continue;
        const o = opt as Record<string, unknown>;
        const url = safeHttpUrl(asString(o.url) || asString(o.link));
        if (!url) continue;
        offers.push({
          retailer:
            asString(o.seller_name) ||
            asString(o.merchant) ||
            retailerFromUrl(url),
          price:
            asPositivePrice(o.price) ??
            asPositivePrice(o.total_price) ??
            asPositivePrice(o.item_price),
          currency: asString(o.currency) || asString(row.currency) || "USD",
          url,
        });
      }
    }

    const url = safeHttpUrl(asString(row.url) || asString(row.link));
    if (url) {
      offers.push({
        retailer:
          asString(row.seller_name) ||
          asString(row.merchant) ||
          asString(row.store) ||
          retailerFromUrl(url),
        price:
          asPositivePrice(row.price) ??
          asPositivePrice(row.item_price) ??
          asPositivePrice(row.total_price) ??
          asPositivePrice(row.final_price),
        currency: asString(row.currency) || "USD",
        url,
      });
    }
  }

  const seen = new Set<string>();
  return offers.filter((o) => {
    const key = `${o.retailer}|${o.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new TimeoutError("Bright Data request aborted");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TimeoutError("Bright Data request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function mergeSignals(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new TimeoutError(`Bright Data timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onOuter = () => {
    ctrl.abort(outer?.reason ?? new TimeoutError("Bright Data request aborted"));
  };
  if (outer) {
    if (outer.aborted) onOuter();
    else outer.addEventListener("abort", onOuter, { once: true });
  }

  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<Response> {
  const { signal, cleanup } = mergeSignals(outer, timeoutMs);
  try {
    return await fetch(url, { ...init, signal, cache: "no-store" });
  } catch (err) {
    if (signal.aborted) {
      const reason = signal.reason;
      if (reason instanceof TimeoutError) throw reason;
      throw new TimeoutError("Bright Data request timed out");
    }
    throw err;
  } finally {
    cleanup();
  }
}

async function fetchSnapshot(
  apiKey: string,
  snapshotId: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? SEARCH_BUDGET_MS;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new TimeoutError("Bright Data job aborted");
    }
    attempt += 1;
    const remaining = deadline - Date.now();
    const progress = await fetchJson(
      `${API_BASE}/progress/${snapshotId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      Math.min(FETCH_TIMEOUT_MS, Math.max(1_000, remaining)),
      options.signal,
    );
    if (progress.ok) {
      const body = (await progress.json()) as { status?: string };
      if (body.status === "ready") {
        const snapRemaining = deadline - Date.now();
        const snap = await fetchJson(
          `${API_BASE}/snapshot/${snapshotId}?format=json`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
          Math.min(FETCH_TIMEOUT_MS, Math.max(1_000, snapRemaining)),
          options.signal,
        );
        if (!snap.ok) {
          throw new Error(`Snapshot download failed (${snap.status})`);
        }
        return snap.json();
      }
      if (body.status === "failed" || body.status === "canceled") {
        throw new Error(`Bright Data job ${body.status}`);
      }
    }
    const wait = Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (wait <= 0) break;
    await sleep(wait, options.signal);
  }

  throw new TimeoutError(
    `Bright Data job timed out after ${attempt} poll(s) (~${timeoutMs}ms)`,
  );
}

export async function brightScrape(options: {
  datasetId: string;
  body: unknown;
  extraParams?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("BRIGHTDATA_API_KEY is not set");

  const timeoutMs = options.timeoutMs ?? SEARCH_BUDGET_MS;
  const deadline = Date.now() + timeoutMs;

  const params = new URLSearchParams({
    dataset_id: options.datasetId,
    format: "json",
    ...options.extraParams,
  });

  const triggerBudget = Math.min(FETCH_TIMEOUT_MS, timeoutMs);
  const res = await fetchJson(
    `${API_BASE}/scrape?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.body),
    },
    triggerBudget,
    options.signal,
  );

  if (res.status === 202) {
    const data = (await res.json()) as { snapshot_id?: string };
    if (!data.snapshot_id) throw new Error("Bright Data returned 202 without snapshot_id");
    const remaining = Math.max(1_000, deadline - Date.now());
    return fetchSnapshot(apiKey, data.snapshot_id, {
      timeoutMs: remaining,
      signal: options.signal,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Bright Data API key invalid or unauthorized (${res.status})`,
      );
    }
    throw new Error(`Bright Data error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

export function rowsFromResponse(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
    }
  }
  return [];
}

export function isAmazonProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return false;
    return /\/(dp|gp\/product)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

export function normalizeAmazonUrl(urlOrAsin: string): string | null {
  const trimmed = urlOrAsin.trim();
  if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
    return `https://www.amazon.com/dp/${trimmed.toUpperCase()}`;
  }
  if (isAmazonProductUrl(trimmed)) {
    try {
      const u = new URL(trimmed);
      const match = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (match) return `https://www.amazon.com/dp/${match[1].toUpperCase()}`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * When Amazon search rows lack a real price (sentinel 0 / missing), enrich the
 * first few via the product dataset in one batched scrape. Best-effort with a
 * short timeout so search can still return titles/links.
 */
export async function enrichMissingAmazonPrices(
  hits: ProductHit[],
  options: { limit?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProductHit[]> {
  const limit = Math.max(0, Math.min(options.limit ?? 5, 8));
  const timeoutMs = options.timeoutMs ?? ENRICH_BUDGET_MS;
  if (!limit || !getApiKey() || timeoutMs < 1_000) return hits;

  const needEnrich = hits
    .map((hit, index) => ({ hit, index }))
    .filter(({ hit }) => hit.price == null)
    .slice(0, limit);

  if (!needEnrich.length) return hits;

  const body = needEnrich
    .map(({ hit }) => {
      const url = normalizeAmazonUrl(hit.asin || hit.url);
      return url ? { url } : null;
    })
    .filter((row): row is { url: string } => !!row);

  if (!body.length) return hits;

  try {
    const data = await brightScrape({
      datasetId: DATASETS.amazonProduct,
      body,
      timeoutMs,
      signal: options.signal,
    });
    const byAsin = new Map<string, ProductHit>();
    const byUrl = new Map<string, ProductHit>();
    for (const row of rowsFromResponse(data)) {
      const product = mapAmazonProductRow(row);
      if (!product || product.price == null) continue;
      if (product.asin) byAsin.set(product.asin.toUpperCase(), product);
      byUrl.set(product.url.replace(/[?#].*$/, ""), product);
      const normalized = normalizeAmazonUrl(product.asin || product.url);
      if (normalized) byUrl.set(normalized, product);
    }

    return hits.map((hit) => {
      if (hit.price != null) return hit;
      const fromAsin = hit.asin ? byAsin.get(hit.asin.toUpperCase()) : undefined;
      const fromUrl =
        byUrl.get(hit.url.replace(/[?#].*$/, "")) ||
        (normalizeAmazonUrl(hit.asin || hit.url)
          ? byUrl.get(normalizeAmazonUrl(hit.asin || hit.url)!)
          : undefined);
      const enriched = fromAsin || fromUrl;
      if (!enriched || enriched.price == null) return hit;
      return {
        ...hit,
        price: enriched.price,
        currency: enriched.currency || hit.currency,
        image: hit.image || enriched.image,
      };
    });
  } catch {
    // Enrichment is optional — return original hits on timeout/failure.
    return hits;
  }
}
