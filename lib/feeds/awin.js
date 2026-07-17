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
    pitch: (raw.description || "").slice(0, 140) || null,
  };
}

async function fetchAndParseFeedCsv(url, maxRows = 0) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`feed download failed: ${resp.status}`);

  // Hard cap on how many bytes we read from a feed. Some advertiser feeds
  // are hundreds of MB; downloading and decompressing one in full inside a
  // serverless function exhausts memory. We read at most this many bytes of
  // the (compressed) stream, which is plenty for the limited number of
  // products we import per run.
  const MAX_BYTES = 12 * 1024 * 1024; // 12MB compressed cap
  const reader = resp.body?.getReader?.();
  let buf;
  if (reader) {
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try { await reader.cancel(); } catch {}
    buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } else {
    buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) buf = buf.subarray(0, MAX_BYTES);
  }

  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  let text;
  if (isGzip) {
    // If we truncated a gzip stream, gunzipSync throws on the incomplete
    // final block — fall back to a lenient inflate that keeps what it can.
    try {
      text = gunzipSync(buf).toString("utf8");
    } catch {
      const { inflateSync } = await import("zlib");
      try { text = inflateSync(buf.subarray(10)).toString("utf8"); }
      catch { text = buf.toString("latin1"); }
    }
  } else {
    text = buf.toString("utf8");
  }

  const head = text.slice(0, 200).trim().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) {
    throw new Error(
      "Awin returned an HTML page instead of feed data — usually means the datafeed API key is wrong, or you're not joined to any advertiser feeds yet."
    );
  }
  const rows = parseCsv(text);
  text = null;
  const objects = rowsToObjects(maxRows > 0 ? rows.slice(0, maxRows + 1) : rows);
  return objects;
}

// Fetches products from exactly ONE advertiser feed, chosen by cursor
// index into the (filtered) feed list. Returns { listings, feedCount,
// downloadedIndex } so the caller can advance the cursor. Downloading a
// single feed per run is what keeps memory bounded — looping through many
// feeds in one serverless invocation was the cause of the OOM crashes.
export async function fetchAwinFeed(dataFeedApiKey, { limit = 500, skipIds = new Set(), cursor = 0 } = {}) {
  if (!dataFeedApiKey) {
    console.warn("AWIN_DATAFEED_API_KEY not set — skipping Awin sync");
    return { listings: [], feedCount: 0, downloadedIndex: -1 };
  }

  // Step 1: the feed list (plain CSV, one row per advertiser feed).
  const listUrl = `https://productdata.awin.com/datafeed/list/apikey/${dataFeedApiKey}`;
  const allFeeds = await fetchAndParseFeedCsv(listUrl);

  // Keep only feeds we can actually use: must have a URL, and — if a
  // membership column is present — must be a JOINED advertiser. Match the
  // status exactly: a naive /joined/ test also matches "Not Joined"
  // (because "Joined" is a substring), which let unjoined feeds through
  // and made the cursor download huge feeds we can't earn from.
  const usableFeeds = allFeeds.filter((feed) => {
    const keys = Object.keys(feed);
    const urlKey = keys.find((k) => k.trim().toLowerCase() === "url");
    const statusKey = keys.find((k) => k.trim().toLowerCase().includes("membership"));
    if (!urlKey || !feed[urlKey]) return false;
    if (statusKey) {
      const status = String(feed[statusKey] || "").trim().toLowerCase();
      // Accept only genuine joined/active states; reject "not joined",
      // "pending", "rejected", "suspended", empty, etc.
      const joined = status === "joined" || status === "active" || status === "approved";
      if (!joined) return false;
    }
    return true;
  });

  if (usableFeeds.length === 0) {
    return { listings: [], feedCount: 0, downloadedIndex: -1 };
  }

  // Pick exactly ONE feed, wrapping around the list by cursor.
  const index = cursor % usableFeeds.length;
  const feed = usableFeeds[index];
  const urlKey = Object.keys(feed).find((k) => k.trim().toLowerCase() === "url");
  const url = feed[urlKey];

  const listings = [];
  try {
    const products = await fetchAndParseFeedCsv(url, limit * 4);
    for (const raw of products) {
      if (listings.length >= limit) break;
      const normalized = parseAwinProduct(raw);
      if (normalized && !skipIds.has(normalized.externalId)) listings.push(normalized);
    }
  } catch (err) {
    console.error("Awin: failed to fetch feed at index", index, err.message);
  }

  return { listings, feedCount: usableFeeds.length, downloadedIndex: index };
}
