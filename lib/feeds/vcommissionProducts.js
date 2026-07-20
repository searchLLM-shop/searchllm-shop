// lib/feeds/vcommissionProducts.js
//
// Parses vCommission product feed CSVs (as supplied for the Shopsy campaign).
// This is SEPARATE from lib/feeds/vcommission.js, which reads campaigns
// (store-level offers) from the Trackier API. The Publisher API has no
// product endpoint — verified against the full OpenAPI spec — so product
// data arrives as hosted CSV files instead, exactly like Awin's datafeed.
//
// Real columns (validated against the delivered files):
//   preview_url, campaign_id, campaign_title, tracking_url, product_id,
//   name, availability, price, sale_price, discount, url, image_url,
//   gender, age_group, description, google_product_category,
//   sub_category, category, sub_category2, color, brand, condition
//
// tracking_url is the per-product affiliate deeplink — it already contains
// the campaign_id, pub_id, and a url= parameter pointing at the exact
// product page. That is what makes product-level recommendation possible:
// we can say "this specific item" instead of "this shop sells things".

import { parseCsv } from "./awin";
import { mapCategory, deriveKeywords } from "./normalizedListing";

// Feed categories are marketplace taxonomy, not shopper language. Map the
// useful ones; "Shopsy" is the merchant's own catch-all and carries no
// signal, so those rows fall back to the product name for categorisation.
const FEED_CATEGORY_MAP = {
  coreelectronics: "electronics",
  emergingelectronics: "electronics",
  lifestyle: "fashion",
  home: "home",
};

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Feed prices are INR with a trailing .0 — render as a clean rupee amount.
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function parseProductRow(raw) {
  const id = raw.product_id;
  const name = raw.name;
  const link = raw.tracking_url;
  if (!id || !name || !link) return null;

  // Skip anything not purchasable — recommending an out-of-stock product is
  // a broken recommendation regardless of how well it matches.
  const availability = String(raw.availability || "").toLowerCase();
  if (availability && !availability.includes("in stock")) return null;

  const price = money(raw.sale_price) || money(raw.price);

  const feedCat = String(raw.category || "").trim().toLowerCase();
  const mapped = FEED_CATEGORY_MAP[feedCat];
  // sub_category is a breadcrumb like
  // "CoreElectronics > PersonalHealthCare > ... > DigitalThermometer"
  // whose tail is the most specific and most searchable part.
  const leaf = String(raw.sub_category2 || raw.sub_category || "")
    .split(">")
    .pop()
    .trim();
  const category = mapped || mapCategory(`${leaf} ${name}`);

  // Split CamelCase leaf categories ("DigitalThermometer") into real words so
  // they can match how a shopper actually types.
  const leafWords = leaf.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

  const brand = (raw.brand || "").trim() || null;
  const keywords = deriveKeywords(`${name} ${leafWords} ${brand || ""}`, category);

  return {
    externalId: String(id),
    brand: brand || "Shopsy",
    product: name.slice(0, 300),
    price,
    category,
    keywords,
    networkLink: link,
    imageUrl: raw.image_url || null,
    merchantDomain: (() => {
      try { return new URL(raw.url || raw.preview_url).hostname.replace(/^www\./, ""); }
      catch { return null; }
    })(),
    // Only surface a discount the feed actually reports, never a computed or
    // implied one — a fake "was/now" price is the oldest trick in retail.
    discount: Number(raw.discount) > 0 ? `${Math.round(Number(raw.discount))}% off` : null,
    pitch: (raw.description || "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    regions: ["IN"], // Shopsy is India-only
  };
}

/**
 * Parses a product feed CSV.
 * @param {string} text raw CSV contents
 * @param {object} opts
 * @param {number} opts.limit    max listings to return
 * @param {Set}    opts.skipIds  external IDs already imported
 * @param {number} opts.minPrice skip very cheap items (marketplace noise)
 */
export function parseProductFeed(text, { limit = 500, skipIds = new Set(), minPrice = 0 } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());

  const listings = [];
  for (let i = 1; i < rows.length && listings.length < limit; i++) {
    const obj = {};
    header.forEach((h, j) => { obj[h] = rows[i][j] ?? ""; });

    if (minPrice > 0) {
      const p = Number(obj.sale_price || obj.price);
      if (!Number.isFinite(p) || p < minPrice) continue;
    }

    const listing = parseProductRow(obj);
    if (listing && !skipIds.has(listing.externalId)) listings.push(listing);
  }
  return listings;
}

/**
 * Downloads a SLICE of a hosted feed and parses it.
 *
 * These feeds run to 100MB. Reading from the start every run meant two
 * problems: each sync pulled and parsed megabytes only to discard almost all
 * of it, and once the first slice was fully imported the feed went
 * permanently empty because the rest was never reached.
 *
 * Instead we use HTTP range requests to walk through the file a few MB at a
 * time, remembering the byte offset between runs. The header line is fetched
 * separately since it only exists at the start.
 *
 * @param {string} feedUrl
 * @param {object} opts
 * @param {number} opts.offset    byte offset to read from
 * @param {number} opts.chunkSize bytes to read this run
 * @returns {{listings: Array, nextOffset: number, done: boolean}}
 */
export async function fetchVcommissionProductFeed(feedUrl, opts = {}) {
  const { limit = 150, skipIds = new Set(), minPrice = 0, offset = 0, chunkSize = 3 * 1024 * 1024 } = opts;
  if (!feedUrl) return { listings: [], nextOffset: 0, done: true };

  // 1. Header — only present at the very start of the file.
  const headResp = await fetch(feedUrl, { headers: { Range: "bytes=0-8191" } });
  if (!headResp.ok && headResp.status !== 206) {
    throw new Error(`feed header fetch failed: ${headResp.status}`);
  }
  const headerLine = (await headResp.text()).split("\n")[0];
  if (!headerLine) throw new Error("feed appears empty");
  const header = parseCsv(headerLine)[0].map((h) => h.trim());

  // 2. The slice for this run.
  const end = offset + chunkSize - 1;
  const resp = await fetch(feedUrl, { headers: { Range: `bytes=${offset}-${end}` } });
  if (!resp.ok && resp.status !== 206) {
    throw new Error(`feed slice fetch failed: ${resp.status}`);
  }

  // Content-Range tells us the file's true size, so we know when we're done.
  const contentRange = resp.headers.get("content-range") || "";
  const totalSize = Number(contentRange.split("/")[1]) || 0;

  let text = await resp.text();
  if (!text.trim()) return { listings: [], nextOffset: 0, done: true };

  // A slice almost certainly starts and ends mid-row. Drop the partial first
  // line (unless we're at the very beginning, where it's the header) and the
  // partial last line, then carry the offset back to the last clean break.
  const firstBreak = text.indexOf("\n");
  let consumedFrom = offset;
  if (firstBreak >= 0) {
    consumedFrom = offset + firstBreak + 1;
    text = text.slice(firstBreak + 1);
  }
  const lastBreak = text.lastIndexOf("\n");
  let consumedTo = consumedFrom + Buffer.byteLength(text, "utf8");
  if (lastBreak >= 0) {
    consumedTo = consumedFrom + Buffer.byteLength(text.slice(0, lastBreak + 1), "utf8");
    text = text.slice(0, lastBreak);
  }

  const rows = parseCsv(text);
  const listings = [];
  for (const row of rows) {
    if (listings.length >= limit) break;
    const obj = {};
    header.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    if (minPrice > 0) {
      const p = Number(obj.sale_price || obj.price);
      if (!Number.isFinite(p) || p < minPrice) continue;
    }
    const listing = parseProductRow(obj);
    if (listing && !skipIds.has(listing.externalId)) listings.push(listing);
  }

  const done = totalSize > 0 && consumedTo >= totalSize;
  return { listings, nextOffset: done ? 0 : consumedTo, done };
}
