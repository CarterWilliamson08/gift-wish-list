"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductHit, RetailerOffer, WishItem } from "@/lib/types";
import {
  buildShareMessage,
  formatMoney,
  loadWishlist,
  saveWishlist,
} from "@/lib/wishlist-storage";

type Banner = { text: string; sample?: boolean } | null;

function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* ignore */
  }
  return undefined;
}

export default function WishListApp() {
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [items, setItems] = useState<WishItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setItems(loadWishlist());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveWishlist(items);
  }, [items, ready]);

  const message = useMemo(() => buildShareMessage(items), [items]);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setStarted(true);
    setSearching(true);
    setBanner(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = (await res.json()) as {
        results?: ProductHit[];
        sample?: boolean;
        message?: string;
        error?: string;
      };
      if (res.status === 429) {
        throw new Error(data.error || "Rate limit reached — try again later.");
      }
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results || []);
      if (data.sample || data.message) {
        setBanner({
          text: data.message || "Sample data mode",
          sample: true,
        });
      } else {
        setBanner(null);
      }
    } catch (err) {
      setBanner({
        text: err instanceof Error ? err.message : "Search failed",
      });
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function addToList(hit: ProductHit) {
    const url = safeHref(hit.url);
    if (!url) return;
    setItems((prev) => {
      if (prev.some((p) => p.url === url || (hit.asin && p.asin === hit.asin))) {
        return prev;
      }
      const next: WishItem = {
        id: hit.id,
        title: hit.title,
        price: hit.price,
        currency: hit.currency,
        url,
        image: safeHref(hit.image) ?? null,
        asin: hit.asin,
        addedAt: new Date().toISOString(),
      };
      return [next, ...prev];
    });
    setExpandedId(hit.id);
    void compareItem(hit);
  }

  async function compareItem(hit: Pick<WishItem, "id" | "title" | "price">) {
    setComparingId(hit.id);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: hit.title, price: hit.price }),
      });
      const data = (await res.json()) as {
        offers?: RetailerOffer[];
        sample?: boolean;
        message?: string;
        error?: string;
      };
      if (res.status === 401 || res.status === 429) {
        setBanner({ text: data.error || "Could not compare prices." });
        return;
      }
      if (data.sample && data.message) {
        setBanner({ text: data.message, sample: true });
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === hit.id ? { ...item, offers: data.offers || [] } : item,
        ),
      );
    } catch {
      // keep existing offers
    } finally {
      setComparingId(null);
    }
  }

  function switchLink(itemId: string, offer: RetailerOffer) {
    const url = safeHref(offer.url);
    if (!url) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              url,
              price: offer.price ?? item.price,
              currency: offer.currency || item.currency,
            }
          : item,
      ),
    );
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setBanner({ text: "Could not copy — select the message preview instead." });
    }
  }

  if (!ready) {
    return <div className="shell loading">Loading…</div>;
  }

  if (!started) {
    return (
      <div className="shell landing">
        <div className="glow" aria-hidden />
        <main className="landing-inner">
          <h1 className="brand">Carter&apos;s Wish List</h1>
          <p className="tagline">Birthday &amp; Christmas gifts, priced and ready to share.</p>
          <p className="lede">
            Search Amazon, compare other stores, save your picks on this phone — then copy a
            plain-text list for family.
          </p>
          <form className="search-row landing-search" onSubmit={runSearch}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a gift idea..."
              aria-label="Search gifts"
              autoFocus
            />
            <button type="submit" className="btn-accent" disabled={searching}>
              {searching ? "…" : "Search"}
            </button>
          </form>
          {items.length > 0 && (
            <button
              type="button"
              className="skip-link"
              onClick={() => setStarted(true)}
            >
              Skip to my list
            </button>
          )}
          {items.length === 0 && (
            <button
              type="button"
              className="skip-link"
              onClick={() => setStarted(true)}
            >
              Skip to my list
            </button>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="shell app">
      <div className="glow soft" aria-hidden />
      <header className="topbar">
        <h1 className="brand compact">Carter&apos;s Wish List</h1>
        <button type="button" className="btn-ghost" onClick={copyMessage}>
          {copied ? "Copied" : "Copy message"}
        </button>
      </header>

      <main className="panel">
        <section className="block">
          <h2>Find a gift</h2>
          <form className="search-row" onSubmit={runSearch}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Amazon…"
              aria-label="Search Amazon"
            />
            <button type="submit" className="btn-go" disabled={searching} aria-label="Search">
              {searching ? "…" : "Go"}
            </button>
          </form>
          {banner && (
            <p className={`banner ${banner.sample ? "sample" : ""}`}>{banner.text}</p>
          )}
        </section>

        <section className="block">
          <h3>Amazon matches</h3>
          {searching && <p className="muted">Searching…</p>}
          {!searching && results.length === 0 && (
            <p className="muted">Search above to see Amazon matches.</p>
          )}
          <ul className="hit-list">
            {results.map((hit) => {
              const href = safeHref(hit.url);
              const img = safeHref(hit.image);
              return (
              <li key={hit.id} className="hit">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" width={56} height={56} />
                ) : (
                  <div className="img-fallback" />
                )}
                <div className="hit-body">
                  <p className="hit-title">{hit.title}</p>
                  <p className="hit-meta">
                    <span>{formatMoney(hit.price, hit.currency)}</span>
                    <span className="dot">·</span>
                    <span>{hit.retailer}</span>
                  </p>
                  <div className="hit-actions">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    ) : null}
                    <button type="button" className="btn-pill" onClick={() => addToList(hit)}>
                      Add to list
                    </button>
                  </div>
                </div>
              </li>
            );
            })}
          </ul>
        </section>

        <section className="block">
          <h3>My list ({items.length})</h3>
          {items.length === 0 && (
            <p className="muted">
              Nothing saved yet. Search above and tap <strong>Add to list</strong>.
            </p>
          )}
          <ul className="wish-list">
            {items.map((item) => {
              const open = expandedId === item.id;
              const cheapest = item.offers
                ?.filter((o) => o.price != null)
                .slice()
                .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
              return (
                <li key={item.id} className={`wish ${open ? "open" : ""}`}>
                  <button
                    type="button"
                    className="wish-head"
                    onClick={() => setExpandedId(open ? null : item.id)}
                  >
                    <span className="wish-title">{item.title}</span>
                    <span className="wish-price">
                      {formatMoney(item.price, item.currency)}
                    </span>
                  </button>
                  {open && (
                    <div className="wish-body">
                      {comparingId === item.id && (
                        <p className="muted">Comparing retailers…</p>
                      )}
                      {cheapest && (
                        <p className="cheapest">
                          cheapest {formatMoney(cheapest.price, cheapest.currency)} at{" "}
                          {cheapest.retailer}
                        </p>
                      )}
                      {item.offers && item.offers.length > 0 && (
                        <ul className="offers">
                          {item.offers.map((offer) => {
                            const selected = offer.url === item.url;
                            return (
                              <li key={`${offer.retailer}-${offer.url}`}>
                                <button
                                  type="button"
                                  className={`offer ${selected ? "selected" : ""}`}
                                  onClick={() => switchLink(item.id, offer)}
                                >
                                  <span>{offer.retailer}</span>
                                  <span>
                                    {formatMoney(offer.price, offer.currency)}
                                    {selected ? " ✓" : ""}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="wish-actions">
                        {safeHref(item.url) ? (
                          <a
                            href={safeHref(item.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open saved link
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => void compareItem(item)}
                        >
                          Refresh compare
                        </button>
                        <button
                          type="button"
                          className="linkish danger"
                          onClick={() => removeItem(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="block">
          <h3>Message preview</h3>
          <pre className="message">{message}</pre>
        </section>

        <p className="footer-note">
          Personal list on this device · prices via Bright Data when configured
        </p>
      </main>
    </div>
  );
}
