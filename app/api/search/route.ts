import {
  brightScrape,
  DATASETS,
  enrichMissingAmazonPrices,
  getApiKey,
  mapAmazonSearchRow,
  rowsFromResponse,
} from "@/lib/brightdata";
import { SAMPLE_SEARCH } from "@/lib/sample-data";
import { jsonPrivate, protectBrightDataRoute } from "@/lib/protect-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        message: "Sample data — add BRIGHTDATA_API_KEY for live Amazon search.",
      },
      { headers },
    );
  }

  try {
    const data = await brightScrape({
      datasetId: DATASETS.amazonSearch,
      body: [
        {
          keyword,
          url: "https://www.amazon.com",
          pages_to_search: 1,
        },
      ],
    });
    const mapped = rowsFromResponse(data)
      .map(mapAmazonSearchRow)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, 12);

    // Search often returns final_price=0 for consoles; enrich top misses via product dataset.
    const results = await enrichMissingAmazonPrices(mapped, { limit: 5 });

    return jsonPrivate({ results, sample: false }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return jsonPrivate(
      {
        results: SAMPLE_SEARCH,
        sample: true,
        message: `Live search unavailable (${message}). Showing sample data.`,
      },
      { headers },
    );
  }
}
