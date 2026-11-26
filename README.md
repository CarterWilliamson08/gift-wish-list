# Carter's Wish List

Mobile-first Birthday / Christmas gift wish list. Search Amazon, save title + price + link on this device, compare other retailers via Google Shopping, switch the saved link, and **Copy message** for family.

List data stays in the browser (`localStorage`). There are no accounts.

## Stack

- Next.js App Router (React)
- Bright Data Scraper API (server routes only)
- Sample-data fallback when `BRIGHTDATA_API_KEY` is missing

## Local run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Production:

```bash
npm run build && npm start
```

## Secret: `BRIGHTDATA_API_KEY`

Never hardcode the key. Never put it in `NEXT_PUBLIC_*` or commit it.

1. Create a Bright Data API token in your Bright Data account.
2. For local runs, export it in your shell (optional — without it the UI uses sample products):

   ```bash
   export BRIGHTDATA_API_KEY=your_token_here
   npm run dev
   ```

3. For the Cursor-hosted app: Dashboard → Cloud Agents → Secrets (or the Secrets step in the publish dialog). Create a secret named exactly **`BRIGHTDATA_API_KEY`**, then bind it to this project. Live Amazon + Google Shopping replace sample mode after the secret is set and the app is republished/redeployed.

## Bright Data datasets

| Purpose | Dataset ID | Route |
| --- | --- | --- |
| Amazon Products Search | `gd_lwdb4vjm1ehb499uxs` | `POST /api/search` |
| Amazon Product (URL/ASIN) | `gd_l7q7dkf244hwjntr0` | `POST /api/product` |
| Google Shopping compare (keyword discover) | `gd_ltppk50q18kdw67omz` | `POST /api/compare` |

The API key is read only on the server (`process.env.BRIGHTDATA_API_KEY`).

## Rate limits (public app)

This app is published **public** — anonymous visitors can search. `/api/search`, `/api/product`, and `/api/compare` apply a household rate limit (8 requests/minute and 40/day per IP, or per Cursor identity when present) before spending Bright Data quota. There is no hard sign-in gate.

## Features

- Amazon-first search with Add to list
- Retailer compare + switch saved link
- Copy plain-text message for family
- Sample mode banner when the secret is absent
- Per-IP (or soft identity) rate limits on paid scrape routes
