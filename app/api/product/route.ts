import { NextResponse } from "next/server";
import {
  brightScrape,
  DATASETS,
  getApiKey,
  mapAmazonProductRow,
  normalizeAmazonUrl,
  rowsFromResponse,
} from "@/lib/brightdata";
import { SAMPLE_SEARCH } from "@/lib/sample-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw = "";
  try {
    const body = (await request.json()) as { url?: string; asin?: string };
    raw = (body.url || body.asin || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const amazonUrl = normalizeAmazonUrl(raw);
  if (!amazonUrl) {
    return NextResponse.json(
      { error: "Provide a valid Amazon product URL or ASIN." },
      { status: 400 },
    );
  }

  if (!getApiKey()) {
    const asin = amazonUrl.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
    const hit =
      SAMPLE_SEARCH.find((p) => p.asin === asin) || SAMPLE_SEARCH[0];
    return NextResponse.json({
      product: { ...hit, url: amazonUrl },
      sample: true,
      message: "Sample data — add BRIGHTDATA_API_KEY for live product lookup.",
    });
  }

  try {
    const data = await brightScrape({
      datasetId: DATASETS.amazonProduct,
      body: [{ url: amazonUrl }],
    });
    const product = rowsFromResponse(data)
      .map(mapAmazonProductRow)
      .find(Boolean);

    if (!product) {
      return NextResponse.json(
        { error: "No product data returned." },
        { status: 404 },
      );
    }

    return NextResponse.json({ product, sample: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Product lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
