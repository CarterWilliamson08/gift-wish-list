import {
  brightScrape,
  DATASETS,
  enrichMissingAmazonPrices,
  ENRICH_BUDGET_MS,
  getApiKey,
  mapAmazonSearchRow,
  rowsFromResponse,
  SEARCH_BUDGET_MS,
  TimeoutError,
} from "@/lib/brightdata";
import { SAMPLE_SEARCH } from "@/lib/sample-data";
import { jsonPrivate, protectBrightDataRoute } from "@/lib/protect-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Prefer finishing under the ~30s hosting gateway kill. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const gate = await protectBrightDataRoute(request, "search");
  if (gate instanceof Response) return gate;
  const headers = gate.extraHeaders;

  let keyword = "";
  try {
    const body = (await request.json()) as { q?: string; keyword?: string };
    keyword = (body.q || body.keyword || "").trim();
  } catch {
    return jsonPrivate({ error: "Invalid JSON body" }, { status: 400, headers });
  }

  if (!keyword || keyword.length > 120) {
    return jsonPrivate(
      { error: "Provide a search query (max 120 characters)." },
      { status: 400, headers },
    );
  }

  if (!getApiKey()) {
    const q = keyword.toLowerCase();
    const filtered = SAMPLE_SEARCH.filter((p) =>
      p.title.toLowerCase().includes(q.split(/\s+/)[0] || q),
    );
    return jsonPrivate(
      {
        results: filtered.length ? filtered : SAMPLE_SEARCH,
        sample: true,
        message:
          "Bright Data API key is not configured — showing sample data. Bind BRIGHTDATA_API_KEY and republish for live Amazon search.",
        code: "missing_api_key",
      },
      { headers },
    );
  }

  const started = Date.now();
  const remaining = () => Math.max(0, SEARCH_BUDGET_MS - (Date.now() - started));
  const abort = new AbortController();
  const budgetTimer = setTimeout(() => {
    abort.abort(new TimeoutError("Search budget exceeded"));
  }, SEARCH_BUDGET_MS);

  try {
    // Leave a slice of the budget for optional price enrichment.
    const scrapeBudget = Math.max(5_000, SEARCH_BUDGET_MS - ENRICH_BUDGET_MS - 500);
    const data = await brightScrape({
      datasetId: DATASETS.amazonSearch,
      body: [
        {
          keyword,
          url: "https://www.amazon.com",
          pages_to_search: 1,
        },
      ],
      timeoutMs: scrapeBudget,
      signal: abort.signal,
    });
    const mapped = rowsFromResponse(data)
      .map(mapAmazonSearchRow)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, 12);

    // Enrichment is optional/best-effort — never block search past remaining budget.
    const enrichMs = Math.min(ENRICH_BUDGET_MS, remaining() - 400);
    const results =
      enrichMs >= 1_000
        ? await enrichMissingAmazonPrices(mapped, {
            limit: 5,
            timeoutMs: enrichMs,
            signal: abort.signal,
          })
        : mapped;

    return jsonPrivate({ results, sample: false }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    const timedOut =
      err instanceof TimeoutError ||
      (err instanceof Error && /timed out|aborted|budget/i.test(err.message));
    const keyIssue = /API key|unauthorized|401|403|not set/i.test(message);

    if (timedOut) {
      return jsonPrivate(
        {
          error:
            "Search timed out waiting for Amazon results. Try again in a moment.",
          code: "timeout",
        },
        { status: 504, headers },
      );
    }

    if (keyIssue) {
      return jsonPrivate(
        {
          results: SAMPLE_SEARCH,
          sample: true,
          message: `Bright Data API key problem (${message}). Showing sample data.`,
          code: "invalid_api_key",
        },
        { headers },
      );
    }

    return jsonPrivate(
      {
        results: SAMPLE_SEARCH,
        sample: true,
        message: `Live search unavailable (${message}). Showing sample data.`,
      },
      { headers },
    );
  } finally {
    clearTimeout(budgetTimer);
  }
}
