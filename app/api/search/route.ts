import { NextResponse } from "next/server";
import {
  brightScrape,
  DATASETS,
  getApiKey,
  mapAmazonSearchRow,
  rowsFromResponse,
} from "@/lib/brightdata";
import { SAMPLE_SEARCH } from "@/lib/sample-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let keyword = "";
  try {
    const body = (await request.json()) as { q?: string; keyword?: string };
    keyword = (body.q || body.keyword || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!keyword || keyword.length > 120) {
    return NextResponse.json(
      { error: "Provide a search query (max 120 characters)." },
      { status: 400 },
    );
  }

  if (!getApiKey()) {
    const q = keyword.toLowerCase();
    const filtered = SAMPLE_SEARCH.filter((p) =>
      p.title.toLowerCase().includes(q.split(/\s+/)[0] || q),
    );
    return NextResponse.json({
      results: filtered.length ? filtered : SAMPLE_SEARCH,
      sample: true,
      message: "Sample data — add BRIGHTDATA_API_KEY for live Amazon search.",
    });
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
    const results = rowsFromResponse(data)
      .map(mapAmazonSearchRow)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, 12);

    return NextResponse.json({
      results,
      sample: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json(
      {
        results: SAMPLE_SEARCH,
        sample: true,
        message: `Live search unavailable (${message}). Showing sample data.`,
      },
      { status: 200 },
    );
  }
}
