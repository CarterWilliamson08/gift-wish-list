import type { WishItem } from "./types";

export const STORAGE_KEY = "carters-wish-list-v1";

export function loadWishlist(): WishItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WishItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWishlist(items: WishItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function formatMoney(price: number | null, currency = "USD"): string {
  if (price == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(price);
  } catch {
    return `$${price.toFixed(2)}`;
  }
}

export function buildShareMessage(items: WishItem[]): string {
  if (!items.length) return "Carter's wish list is empty for now.";
  const lines = ["Carter's wish list:", ""];
  for (const item of items) {
    const price = formatMoney(item.price, item.currency);
    lines.push(`• ${item.title} — ${price}`);
    lines.push(`  ${item.url}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
