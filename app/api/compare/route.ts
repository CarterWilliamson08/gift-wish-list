import {
  brightScrape,
  DATASETS,
  getApiKey,
  mapShoppingRows,
  rowsFromResponse,
} from "@/lib/brightdata";
import { sampleOffersFor } from "@/lib/sample-data";
import { jsonPrivate, protectBrightDataRoute } from "@/lib/protect-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await protectBrightDataRoute(request, "compare");
  if (gate instanceof Response) return gate;
  const headers = gate.extraHeaders;

  let keyword = "";
  let amazonPrice: number | null = null;
  try {
    const body = (await request.json()) as {
      q?: string;
      keyword?: string;
      title?: string;
      price?: number | null;
    };
    keyword = (body.q || body.keyword || body.title || "").trim();
    amazonPrice =
      typeof body.price === "number" && Number.isFinite(body.price)
        ? body.price
        : null;
  } catch {
    return jsonPrivate({ error: "Invalid JSON body" }, { status: 400, headers });
  }

  if (!keyword || keyword.length > 160) {
    return jsonPrivate(
      { error: "Provide a product title or keyword to compare." },
      { status: 400, headers },
    );
  }

  if (!getApiKey()) {
    return jsonPrivate(
      {
        offers: sampleOffersFor(keyword, amazonPrice),
        sample: true,
        message:
          "Sample retailer compare — add BRIGHTDATA_API_KEY for live Google Shopping.",
      },
      { headers },
    );
  }

  try {
    const data = await brightScrape({
      datasetId: DATASETS.googleShopping,
      body: {
        input: [{ keyword, country: "US" }],
        limit_per_input: 10,
      },
      extraParams: {
        type: "discover_new",
        discover_by: "keyword",
      },
    });

    const offers = mapShoppingRows(rowsFromResponse(data)).slice(0, 12);
    return jsonPrivate(
      {
        offers: offers.length ? offers : sampleOffersFor(keyword, amazonPrice),
        sample: offers.length === 0,
        message:
          offers.length === 0
            ? "No live offers returned — showing sample compare."
            : undefined,
      },
      { headers },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compare failed";
    return jsonPrivate(
      {
        offers: sampleOffersFor(keyword, amazonPrice),
        sample: true,
        message: `Live compare unavailable (${message}). Showing sample data.`,
      },
      { headers },
    );
  }
}
