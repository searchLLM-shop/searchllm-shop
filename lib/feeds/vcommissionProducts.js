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
  largeappliances: "home",
  lifestyle: "fashion",
  home: "home",
  shopsy: null,   // catch-all carries no signal; fall back to the title
};

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Feed prices are INR with a trailing .0 — render as a clean rupee amount.
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// The LIVE feed schema, confirmed by reading the feed itself:
//   id, title, availability, price, sale_price, discount, link, image_link,
//   gender, age_group, rating, rating_count, description,
//   google_product_category, custom_product_category, parent_category,
//   vertical, color, brand, condition, last_updated
//
// Note this differs from the sample files supplied by email, which used
// product_id / name / tracking_url. Column names here follow the live file.
//
// Critically, `link` is the merchant's own product URL — this feed carries no
// affiliate link. We build the tracked deeplink ourselves by wrapping that URL
// in the campaign's click endpoint, which is what earns the commission.
const CAMPAIGN_ID = process.env.VCOMMISSION_CAMPAIGN_ID || "11008";
const PUB_ID = process.env.VCOMMISSION_PUB_ID || "130649";
const CLICK_BASE = process.env.VCOMMISSION_CLICK_BASE || "https://track.vcommission.com/click";

function buildTrackedLink(productUrl) {
  if (!productUrl) return null;
  try {
    const dest = new URL(productUrl);
    const link = new URL(CLICK_BASE);
    link.searchParams.set("campaign_id", CAMPAIGN_ID);
    link.searchParams.set("pub_id", PUB_ID);
    link.searchParams.set("url", dest.toString());
    return link.toString();
  } catch {
    return null;
  }
}

export function parseProductRow(raw) {
  const id = raw.id;
  const title = raw.title;
  const productUrl = raw.link;
  if (!id || !title || !productUrl) return null;

  const availability = String(raw.availability || "").toLowerCase();
  if (availability && !availability.includes("in stock")) return null;

  const link = buildTrackedLink(productUrl);
  if (!link) return null;

  const price = money(raw.sale_price) || money(raw.price);

  // vertical is the most specific category ("DigitalThermometer");
  // parent_category is the broad one ("CoreElectronics").
  const vertical = String(raw.vertical || "").trim();
  const parent = String(raw.parent_category || "").trim().toLowerCase();
  const mapped = FEED_CATEGORY_MAP[parent];
  const category = mapped || mapCategory(`${vertical} ${title}`);

  // Split CamelCase verticals into words a shopper would actually type.
  const verticalWords = vertical.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const brand = (raw.brand || "").trim();

  const rating = Number(raw.rating);
  const ratingCount = Number(raw.rating_count);

  return {
    externalId: String(id),
    brand: brand || "Shopsy",
    product: String(title).slice(0, 300),
    price,
    category,
    keywords: deriveKeywords(`${title} ${verticalWords} ${brand}`, category),
    networkLink: link,
    imageUrl: raw.image_link || null,
    merchantDomain: (() => {
      try { return new URL(productUrl).hostname.replace(/^www\./, ""); } catch { return null; }
    })(),
    discount: Number(raw.discount) > 0 ? `${Math.round(Number(raw.discount))}% off` : null,
    pitch: String(raw.description || "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    regions: ["IN"],
    // Real shopper ratings — a far better quality signal than price, which is
    // what we were reduced to guessing with before this feed exposed them.
    rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
    ratingCount: Number.isFinite(ratingCount) ? Math.round(ratingCount) : null,
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
  const headerRaw = await headResp.text();
  const headerLine = headerRaw.split("\n")[0];
  if (!headerLine) throw new Error("feed appears empty");
  const headerRow = parseCsv(headerLine)[0];
  if (!headerRow || headerRow.length < 2) {
    throw new Error(`could not parse feed header (got ${headerRow ? headerRow.length : 0} columns from ${headerRaw.length} bytes)`);
  }
  const header = headerRow.map((h) => h.trim());

  // Finding a real row boundary in a mid-file slice is the crux of this whole
  // adapter. Product descriptions contain newlines inside quoted fields, so
  // the first newline in a slice is frequently NOT the start of a row — and
  // starting there misaligns every column, leaving tracking_url empty and
  // every row silently rejected.
  //
  // Guessing from a prefix doesn't work either: some feeds leave preview_url
  // empty, so rows begin with a bare comma. Instead we TEST each candidate
  // boundary by parsing a little of what follows and checking the fields we
  // actually require came out populated. The first candidate that parses
  // correctly is a genuine row start.
  const requiredIdx = {
    id: header.indexOf("id"),
    link: header.indexOf("link"),
  };
  function isAlignedAt(text, nlIndex) {
    const sample = text.slice(nlIndex + 1, nlIndex + 4000);
    const rows = parseCsv(sample);
    if (!rows.length || rows[0].length < header.length - 2) return false;
    const pid = rows[0][requiredIdx.id];
    const plink = rows[0][requiredIdx.link];
    return Boolean(pid && plink && String(plink).startsWith("http"));
  }
  function findAlignedBreak(text, maxAttempts = 12) {
    let from = 0;
    for (let i = 0; i < maxAttempts; i++) {
      const nl = text.indexOf("\n", from);
      if (nl < 0) return -1;
      if (isAlignedAt(text, nl)) return nl;
      from = nl + 1;
    }
    return -1;
  }
  // Diagnostics — a zero-row result should explain itself rather than being
  // silently empty, which is what made this so hard to pin down.
  const diag = {
    headerStatus: headResp.status,
    headerBytes: headerRaw.length,
    columns: header.length,
    hasId: header.includes("id"),
    hasLink: header.includes("link"),
    aligned: true,
  };

  // 2. The slice for this run.
  const end = offset + chunkSize - 1;
  const resp = await fetch(feedUrl, { headers: { Range: `bytes=${offset}-${end}` } });
  if (!resp.ok && resp.status !== 206) {
    throw new Error(`feed slice fetch failed: ${resp.status}`);
  }

  // Content-Range tells us the file's true size, so we know when we're done.
  const contentRange = resp.headers.get("content-range") || "";
  const totalSize = Number(contentRange.split("/")[1]) || 0;

  // A 206 means the range was honoured. A 200 means the server ignored it and
  // is sending the ENTIRE file — for a 100MB feed, calling resp.text() on that
  // would materialise the whole thing in memory and kill the function. Read it
  // as a capped stream instead, and start from the beginning since a
  // non-ranged response can't be resumed mid-file.
  const rangeHonoured = resp.status === 206;
  let text;
  if (rangeHonoured) {
    text = await resp.text();
  } else {
    console.warn(`Feed server ignored Range header (status ${resp.status}) — falling back to a capped read from the start.`);
    const reader = resp.body?.getReader?.();
    if (reader) {
      const chunks = [];
      let total = 0;
      while (total < chunkSize) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        chunks.push(value);
        total += value.length;
      }
      try { await reader.cancel(); } catch {}
      text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    } else {
      const buf = Buffer.from(await resp.arrayBuffer());
      text = buf.subarray(0, chunkSize).toString("utf8");
    }
  }

  diag.sliceStatus = resp.status;
  diag.sliceBytes = text ? text.length : 0;
  diag.rangeHonoured = rangeHonoured;
  if (!text || !text.trim()) {
    return { listings: [], nextOffset: 0, done: true, diag: { ...diag, reason: "slice was empty" } };
  }

  // A slice almost certainly starts and ends mid-row. Drop the partial first
  // line (unless we're at the very beginning, where it's the header) and the
  // partial last line, then carry the offset back to the last clean break.
  // Find a REAL row boundary: a newline followed by the known row prefix.
  // Falling back to the first newline only when no prefix is available.
  // At offset 0 the first line is the header, which is itself a valid break.
  let firstBreak = offset === 0 ? text.indexOf("\n") : findAlignedBreak(text);
  if (firstBreak < 0) firstBreak = text.indexOf("\n");

  let consumedFrom = offset;
  if (firstBreak >= 0) {
    consumedFrom = offset + Buffer.byteLength(text.slice(0, firstBreak + 1), "utf8");
    text = text.slice(firstBreak + 1);
  }
  const lastBreak = text.lastIndexOf("\n");
  let consumedTo = consumedFrom + Buffer.byteLength(text, "utf8");
  if (lastBreak >= 0) {
    consumedTo = consumedFrom + Buffer.byteLength(text.slice(0, lastBreak + 1), "utf8");
    text = text.slice(0, lastBreak);
  }

  const rows = parseCsv(text);
  diag.rowsParsed = rows.length;
  let rejectedNoId = 0, rejectedPrice = 0, skippedExisting = 0;
  const listings = [];
  for (const row of rows) {
    if (listings.length >= limit) break;
    const obj = {};
    header.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    if (minPrice > 0) {
      const p = Number(obj.sale_price || obj.price);
      if (!Number.isFinite(p) || p < minPrice) { rejectedPrice++; continue; }
    }
    const listing = parseProductRow(obj);
    if (!listing) { rejectedNoId++; continue; }
    if (skipIds.has(listing.externalId)) { skippedExisting++; continue; }
    listings.push(listing);
  }

  // Without range support we can't resume mid-file, so the offset stays at 0
  // and progress comes from skipIds excluding what's already imported.
  Object.assign(diag, { rejectedNoId, rejectedPrice, skippedExisting, kept: listings.length });

  if (!rangeHonoured) {
    return { listings, nextOffset: 0, done: false, rangeSupported: false, diag };
  }
  const done = totalSize > 0 && consumedTo >= totalSize;
  return { listings, nextOffset: done ? 0 : consumedTo, done, rangeSupported: true, diag };
}
