import type { ProductHit, RetailerOffer } from "./types";

export const SAMPLE_SEARCH: ProductHit[] = [
  {
    id: "B09XS7JWHH",
    title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
    price: 328,
    currency: "USD",
    url: "https://www.amazon.com/dp/B09XS7JWHH",
    image:
      "https://m.media-amazon.com/images/I/51aXvjzcukL._AC_UL320_.jpg",
    retailer: "Amazon",
    asin: "B09XS7JWHH",
  },
  {
    id: "B0BSHF29PH",
    title: "Apple AirPods Pro (2nd Generation) USB-C",
    price: 189.99,
    currency: "USD",
    url: "https://www.amazon.com/dp/B0BSHF29PH",
    image:
      "https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_UL320_.jpg",
    retailer: "Amazon",
    asin: "B0BSHF29PH",
  },
  {
    id: "B0CC6K5F9V",
    title: "Kindle Paperwhite (16 GB) — With Ads",
    price: 139.99,
    currency: "USD",
    url: "https://www.amazon.com/dp/B0CC6K5F9V",
    image:
      "https://m.media-amazon.com/images/I/61XAnBkJq9L._AC_UL320_.jpg",
    retailer: "Amazon",
    asin: "B0CC6K5F9V",
  },
];

export function sampleOffersFor(title: string, amazonPrice: number | null): RetailerOffer[] {
  const base = amazonPrice ?? 328;
  return [
    {
      retailer: "Walmart",
      price: Math.round((base * 0.94) * 100) / 100,
      currency: "USD",
      url: `https://www.walmart.com/search?q=${encodeURIComponent(title)}`,
    },
    {
      retailer: "Best Buy",
      price: Math.round((base * 0.97) * 100) / 100,
      currency: "USD",
      url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(title)}`,
    },
    {
      retailer: "Amazon",
      price: base,
      currency: "USD",
      url: `https://www.amazon.com/s?k=${encodeURIComponent(title)}`,
    },
    {
      retailer: "Target",
      price: Math.round((base * 1.02) * 100) / 100,
      currency: "USD",
      url: `https://www.target.com/s?searchTerm=${encodeURIComponent(title)}`,
    },
  ];
}
