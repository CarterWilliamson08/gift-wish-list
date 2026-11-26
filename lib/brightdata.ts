import type { ProductHit, RetailerOffer } from "./types";

export const DATASETS = {
  amazonSearch: "gd_lwdb4vjm1ehb499uxs",
  amazonProduct: "gd_l7q7dkf244hwjntr0",
  googleShopping: "gd_ltppk50q18kdw67omz",
} as const;

const API_BASE = "https://api.brightdata.com/datasets/v3";

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchSnapshot(
  apiKey: string,
  snapshotId: string,
  attempts = 20,
): Promise<unknown> {
  for (let i = 0; i < attempts; i++) {
    const progress = await fetch(`${API_BASE}/progress/${snapshotId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (progress.ok) {
      const body = (await progress.json()) as { status?: string };
      if (body.status === "ready") {
        const snap = await fetch(
          `${API_BASE}/snapshot/${snapshotId}?format=json`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            cache: "no-store",
          },
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
    await sleep(3000);
  }
  throw new Error("Bright Data job timed out");
}

export async function brightScrape(options: {
  datasetId: string;
  body: unknown;
  extraParams?: Record<string, string>;
}): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("BRIGHTDATA_API_KEY is not set");

  const params = new URLSearchParams({
    dataset_id: options.datasetId,
    format: "json",
    ...options.extraParams,
  });

  const res = await fetch(`${API_BASE}/scrape?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options.body),
    cache: "no-store",
  });

  if (res.status === 202) {
    const data = (await res.json()) as { snapshot_id?: string };
    if (!data.snapshot_id) throw new Error("Bright Data returned 202 without snapshot_id");
    return fetchSnapshot(apiKey, data.snapshot_id);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
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
 * first few via the product dataset in one batched scrape. Failures are ignored
 * so search still returns titles/links.
 */
export async function enrichMissingAmazonPrices(
  hits: ProductHit[],
  options: { limit?: number } = {},
): Promise<ProductHit[]> {
  const limit = Math.max(0, Math.min(options.limit ?? 5, 8));
  if (!limit || !getApiKey()) return hits;

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
    return hits;
  }
}
