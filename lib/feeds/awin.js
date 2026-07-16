// lib/feeds/awin.js
//
// Awin publisher product feed adapter — validated against a REAL feed
// file (datafeed for publisher 2967413), not documentation assumptions.
//
// How Awin feeds actually work:
//   1. The feed LIST endpoint returns a CSV of feeds you can access:
//      https://productdata.awin.com/datafeed/list/apikey/{key}
//      Columns include: Advertiser ID, Advertiser Name, Membership Status,
//      Feed ID, ..., URL (the per-feed download link).
//   2. Each feed's URL downloads a GZIPPED CSV of products. Confirmed
//      real columns include: aw_deep_link, product_name, aw_product_id,
//      description, merchant_category, search_price, display_price,
//      currency, merchant_name, brand_name, in_stock, ...
//
// This adapter fetches the list, picks feeds you're joined to, downloads
// each gzipped CSV, and normalizes rows into the shared listing shape.

import { gunzipSync } from "zlib";
import { mapCategory, deriveKeywords } from "./normalizedListing";

// Minimal RFC-4180-ish CSV parser that handles quoted fields containing
// commas, escaped double-quotes ("") and newlines inside quotes. Awin
// descriptions routinely contain all three, so naive split(",") corrupts
// rows — verified against the real feed.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ""; });
    return obj;
  });
}

// Maps one real Awin CSV row to the normalized listing shape.
// Field names verified against a real publisher datafeed.
export function parseAwinProduct(raw) {
  const id = raw.aw_product_id || raw.merchant_product_id;
  const title = raw.product_name;
  const link = raw.aw_deep_link; // the affiliate tracking link (credits your publisher ID)
  if (!id || !title || !link) return null;

  // display_price is pre-formatted ("GBP14.99"); fall back to
  // currency + search_price if absent.
  const price = raw.display_price
    ? raw.display_price
    : raw.search_price
    ? `${raw.currency || ""}${raw.search_price}`.trim()
    : null;

  const category = mapCategory(
    raw.merchant_category || raw.category_name || title
  );

  return {
    externalId: String(id),
    brand: raw.brand_name || raw.merchant_name || "Unknown brand",
    product: title,
    price,
    category,
    keywords: deriveKeywords(`${title} ${raw.category_name || ""}`, category),
    networkLink: link,
    pitch: (raw.description || "").slice(0, 240) || null,
  };
}

async function fetchAndParseFeedCsv(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`feed download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  // Feed downloads are gzipped (confirmed with a real file); the list
  // endpoint is plain CSV. Sniff the gzip magic bytes rather than trust
  // headers, since Awin serves .gz files without content-encoding.
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  const text = isGzip ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  // If Awin returned an HTML page (error, login redirect, or "no feeds
  // available"), it's not CSV — detect it and fail with a clear message
  // rather than producing garbage rows.
  const head = text.slice(0, 200).trim().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) {
    throw new Error(
      "Awin returned an HTML page instead of feed data — usually means the datafeed API key is wrong, or you're not joined to any advertiser feeds yet."
    );
  }
  return rowsToObjects(parseCsv(text));
}

export async function fetchAwinFeed(dataFeedApiKey, { limit = 500 } = {}) {
  if (!dataFeedApiKey) {
    console.warn("AWIN_DATAFEED_API_KEY not set — skipping Awin sync");
    return [];
  }

  // Step 1: the feed list (plain CSV, one row per advertiser feed).
  const listUrl = `https://productdata.awin.com/datafeed/list/apikey/${dataFeedApiKey}`;
  const feeds = await fetchAndParseFeedCsv(listUrl);

  const listings = [];
  for (const feed of feeds) {
    if (listings.length >= limit) break;

    // Column names in the list CSV: "URL" holds the download link;
    // "Membership Status" says whether you're joined to the advertiser.
    // Be tolerant of casing/spacing variations across accounts.
    const keys = Object.keys(feed);
    const urlKey = keys.find((k) => k.trim().toLowerCase() === "url");
    const statusKey = keys.find((k) => k.trim().toLowerCase().includes("membership"));
    const url = urlKey ? feed[urlKey] : null;
    if (!url) continue;
    if (statusKey && feed[statusKey] && !/active|joined|approved/i.test(feed[statusKey])) continue;

    try {
      const products = await fetchAndParseFeedCsv(url);
      for (const raw of products) {
        if (listings.length >= limit) break;
        const normalized = parseAwinProduct(raw);
        if (normalized) listings.push(normalized);
      }
    } catch (err) {
      console.error(`Awin: failed to fetch a feed:`, err.message);
      // Continue to the next advertiser feed rather than failing the run.
    }
  }

  return listings;
}
