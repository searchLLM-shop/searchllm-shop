#!/usr/bin/env node
// scripts/import-vcommission-myntra.mjs
//
// One-time (rerunnable) LOCAL import of the Myntra vCommission product-feed
// CSV exports straight into production Postgres — bypassing the usual
// hosted-URL + Vercel-cron sync path (lib/feeds/sync.js /
// lib/feeds/vcommissionProducts.js) because these are one-off browser-
// downloaded snapshots (Downloads folder, ~800MB each), not a persistent
// HTTP feed URL vCommission serves. If a persistent Myntra feed URL ever
// materializes, switch to the normal path (VCOMMISSION_PRODUCT_FEED_URLS +
// VCOMMISSION_CAMPAIGN_IDS) instead — this script is the stopgap for a
// one-off export, not a replacement for it. (2026-09-10)
//
// Column mapping / categorization logic is INTENTIONALLY duplicated here
// (not imported) from lib/feeds/vcommissionProducts.js and
// lib/feeds/normalizedListing.js: those are ESM `export`-syntax files
// inside a CommonJS package (package.json has no "type": "module"), which
// only Next's own bundler can load — a plain `node` process can't `import`
// them directly. If either of those two files' field-mapping/category
// logic changes, update the copies below by hand to match.
//
// Usage (PowerShell or Bash):
//   $env:DATABASE_URL = "postgres://...supabase pooled connection string..."
//   node scripts/import-vcommission-myntra.mjs "C:\Users\lenovo\Downloads\6aa22826e7713.csv" "C:\Users\lenovo\Downloads\6aa226e4634bf.csv" ...
//
// Optional env vars (mirror lib/db.js's TLS handling):
//   DATABASE_CA_CERT      — Supabase's "Server root certificate" PEM, for
//                           real pinned TLS verification (recommended).
//   DATABASE_SSL_INSECURE=1 — fallback if you don't have the CA cert handy.
//   MIN_PRODUCT_PRICE     — skip rows below this price (matches sync.js's
//                           convention); default 0 (no filtering).
//
// Resumable: after each successfully committed batch, the byte offset
// reached in the CURRENT file is written to .myntra-import-progress.json
// (gitignored, next to this script). Re-running with the same file paths
// picks up from there instead of re-reading from the start of each file —
// safe either way, since the DB upsert is idempotent on
// (network, external_id); re-processing already-imported rows just
// overwrites them with the same data, it doesn't duplicate anything.
//
// A file that errors out (network blip to Supabase, a malformed row, etc.)
// is logged and skipped — the run continues with the next file rather than
// aborting the whole import. Progress already checkpointed for that file
// stays intact, so re-running the same command resumes it from where it
// left off instead of restarting.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = path.join(__dirname, ".myntra-import-progress.json");

const NETWORK = "vCommission";
const DEFAULT_CAMPAIGN_ID = "10882"; // Myntra — https://track.vcommission.com/click?campaign_id=10882&pub_id=130649
const BATCH_SIZE = 400; // matches lib/db.js bulkUpsertFeedListings' MAX_ROWS_PER_STATEMENT
const LOG_EVERY_MS = 5000;

// --- category / keyword logic (duplicated from lib/feeds/normalizedListing.js) ---
const CATEGORY_KEYWORDS = {
  outdoor: ["outdoor", "hiking", "camping", "travel bag", "backpack", "trek"],
  electronics: ["electronics", "headphone", "audio", "laptop", "phone", "computer", "tech", "mobile", "gadget", "appattribution"],
  beauty: ["beauty", "skincare", "cosmetic", "makeup", "fragrance", "nykaa", "cosmetics"],
  home: ["home", "kitchen", "furniture", "decor", "appliance"],
  fashion: ["clothing", "dress", "skirt", "apparel", "fashion", "footwear", "shoes", "jeans", "denim", "accessories", "myntra", "ajio"],
  health: ["nutrition", "supplement", "wellness", "health", "vitamin", "protein", "fitness", "ayurved"],
  shopping: ["ecommerce", "marketplace", "shopping", "store", "shopsy", "flipkart", "grocery"],
};
function mapCategory(rawCategoryOrTitle) {
  const text = (rawCategoryOrTitle || "").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return "other";
}
function deriveKeywords(title, category) {
  const words = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);
  return Array.from(new Set([...words, category]));
}

// --- row mapping (duplicated + generalized from lib/feeds/vcommissionProducts.js) ---
//
// Myntra's export columns differ from Shopsy's live feed:
//   Shopsy:  id, title, link, vertical, parent_category, image_link
//   Myntra:  product_id, name, url, product_type, google_product_category,
//            image_url — AND it already ships a ready-made tracking_url
//            column (campaign_id + pub_id baked in), which Shopsy's feed
//            doesn't have. Prefer that over rebuilding one, since it's the
//            vendor's own authoritative link.
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
const IMAGE_COLUMN_CANDIDATES = ["image_link", "image_url", "img_url", "image", "img"];
function firstImageUrl(raw) {
  for (const col of IMAGE_COLUMN_CANDIDATES) {
    const v = raw[col];
    if (v && String(v).trim().startsWith("http")) return String(v).trim();
  }
  return null;
}
const PUB_ID = "130649";
const CLICK_BASE = "https://track.vcommission.com/click";
function buildTrackedLink(productUrl, campaignId) {
  if (!productUrl) return null;
  try {
    const dest = new URL(productUrl);
    const link = new URL(CLICK_BASE);
    link.searchParams.set("campaign_id", campaignId || DEFAULT_CAMPAIGN_ID);
    link.searchParams.set("pub_id", PUB_ID);
    link.searchParams.set("url", dest.toString());
    return link.toString();
  } catch {
    return null;
  }
}
export function parseProductRow(raw, campaignId) {
  const id = raw.id || raw.product_id;
  const title = raw.title || raw.name;
  const productUrl = raw.link || raw.url || raw.preview_url;
  if (!id || !title || !productUrl) return null;

  const availability = String(raw.availability || "").toLowerCase();
  if (availability && !availability.includes("in stock")) return null;

  const link = raw.tracking_url && String(raw.tracking_url).startsWith("http")
    ? String(raw.tracking_url)
    : buildTrackedLink(productUrl, campaignId);
  if (!link) return null;

  const price = money(raw.sale_price) || money(raw.price);

  // No parent_category column in Myntra's export (that's a Shopsy-only
  // field, mapped via FEED_CATEGORY_MAP in the real app code) — fall
  // straight through to keyword-matching against vertical/title.
  const vertical = String(raw.vertical || raw.product_type || raw.google_product_category || "").trim();
  const category = mapCategory(`${vertical} ${title}`);

  const verticalWords = vertical.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const brand = (raw.brand || "").trim();

  const rating = Number(raw.rating);
  const ratingCount = Number(raw.rating_count);

  const merchantDomain = (() => {
    try { return new URL(productUrl).hostname.replace(/^www\./, ""); } catch { return null; }
  })();
  const domainBrand = merchantDomain ? merchantDomain.split(".")[0] : "";
  const fallbackBrand = domainBrand ? domainBrand.charAt(0).toUpperCase() + domainBrand.slice(1) : "";

  const effectiveCampaignId = raw.campaign_id || campaignId || DEFAULT_CAMPAIGN_ID;

  return {
    externalId: `${effectiveCampaignId}-${id}`,
    brand: brand || fallbackBrand,
    product: String(title).slice(0, 300),
    price,
    category,
    keywords: deriveKeywords(`${title} ${verticalWords} ${brand}`, category),
    networkLink: link,
    imageUrl: firstImageUrl(raw),
    merchantDomain,
    discount: Number(raw.discount) > 0 ? `${Math.round(Number(raw.discount))}% off` : null,
    pitch: String(raw.description || "").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    regions: ["IN"],
    rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
    ratingCount: Number.isFinite(ratingCount) ? Math.round(ratingCount) : null,
  };
}

// --- streaming CSV parser (same state machine as lib/feeds/awin.js's parseCsv, made chunk-friendly) ---
//
// Unlike lib/feeds/vcommissionProducts.js's HTTP-range-based reader, this
// doesn't need row-boundary "alignment scanning" — state persists
// continuously across chunks within one run, so there's never an arbitrary
// mid-row slice to realign. A checkpoint is only ever saved right after a
// fully-parsed row, so resuming can start the next read exactly there.
export class StreamingCsv {
  constructor() {
    this.field = "";
    this.row = [];
    this.inQuotes = false;
  }
  // Feed one decoded text chunk. Returns { rows, lastRowEndIndex } —
  // lastRowEndIndex is the position in THIS chunk right after the last
  // complete row's line terminator (-1 if no row was completed in this
  // chunk), i.e. the only point in this chunk that's actually safe to
  // resume from later. A byte offset mid-row is NOT safe: a fresh process
  // starting there has no memory of the partial field/row this instance
  // was accumulating, so it would misparse the row's tail as if it were a
  // fresh row start — silently misaligning every column after it. (Real
  // bug, found 2026-09-10: the first version of this script checkpointed
  // at the raw end of whatever stream chunk had just been read, which is
  // essentially never a row boundary for a 4MB chunk — resuming produced
  // a long run of "kept 0" rows, all failing validation because their
  // fields were shifted.)
  feed(text) {
    const rows = [];
    let lastRowEndIndex = -1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { this.field += '"'; i++; }
          else this.inQuotes = false;
        } else this.field += c;
      } else if (c === '"') {
        this.inQuotes = true;
      } else if (c === ",") {
        this.row.push(this.field); this.field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        this.row.push(this.field); this.field = "";
        if (this.row.length > 1 || this.row[0] !== "") rows.push(this.row);
        this.row = [];
        lastRowEndIndex = i + 1;
      } else this.field += c;
    }
    return { rows, lastRowEndIndex };
  }
}

// --- DB pool (mirrors lib/db.js's TLS-selection logic) ---
function makePool() {
  const connectionString = process.env.DATABASE_URL;
  const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
  const sslInsecure = process.env.DATABASE_SSL_INSECURE === "1";
  const caCert = process.env.DATABASE_CA_CERT;
  let ssl;
  if (isLocal) ssl = false;
  else if (caCert) ssl = { ca: caCert, rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: !sslInsecure };
  const pool = new pg.Pool({ connectionString, ssl, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
  pool.on("error", (err) => console.error("Postgres pool error (non-fatal):", err.message));
  return pool;
}

// Same INSERT ... ON CONFLICT shape as lib/db.js's bulkUpsertFeedListings —
// including its MAX_ROWS_PER_STATEMENT chunking. Postgres caps a statement
// at 65535 bind parameters; at 15 columns that's ~4300 rows, and a 4MB
// stream chunk here routinely yields more rows than BATCH_SIZE (400) once
// pushed in one go (real risk found 2026-09-10 while fixing the checkpoint
// bug above — worth guarding properly rather than trusting chunk sizing).
async function bulkUpsert(pool, listings) {
  if (!listings.length) return { inserted: 0, updated: 0 };
  // Postgres refuses to let one INSERT...ON CONFLICT DO UPDATE affect the
  // same conflict-target row twice ("ON CONFLICT DO UPDATE command cannot
  // affect row a second time") — real hit, 2026-09-10: this feed genuinely
  // repeats some product_ids within a single file (likely the same SKU
  // appearing under more than one category export merged into one CSV).
  // Keep only the last occurrence within this batch; harmless, since it's
  // a pure upsert of the same source row either way.
  if (listings.length > 1) {
    const seen = new Map();
    for (const l of listings) seen.set(l.externalId, l);
    listings = Array.from(seen.values());
  }
  const MAX_ROWS_PER_STATEMENT = 400;
  if (listings.length > MAX_ROWS_PER_STATEMENT) {
    let inserted = 0, updated = 0;
    for (let i = 0; i < listings.length; i += MAX_ROWS_PER_STATEMENT) {
      const part = await bulkUpsert(pool, listings.slice(i, i + MAX_ROWS_PER_STATEMENT));
      inserted += part.inserted;
      updated += part.updated;
    }
    return { inserted, updated };
  }
  const cols = 15;
  const valueRows = [];
  const params = [];
  listings.forEach((l, i) => {
    const b = i * cols;
    valueRows.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, 'pending', 'feed', $${b + 9}, now(), $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15})`
    );
    params.push(
      l.brand, l.product, l.price, l.category, l.keywords,
      NETWORK, l.networkLink, l.pitch, l.externalId, l.regions || null,
      l.imageUrl || null, l.merchantDomain || null, l.discount || null,
      l.rating ?? null, l.ratingCount ?? null
    );
  });
  const { rows } = await pool.query(
    `INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status, source, external_id, last_synced_at, regions, image_url, merchant_domain, discount, rating, rating_count)
     VALUES ${valueRows.join(", ")}
     ON CONFLICT (network, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET
       brand = EXCLUDED.brand, product = EXCLUDED.product, price = EXCLUDED.price,
       category = EXCLUDED.category,
       keywords = CASE WHEN listings.keywords_enriched_at IS NOT NULL
                       THEN listings.keywords ELSE EXCLUDED.keywords END,
       network_link = EXCLUDED.network_link, pitch = EXCLUDED.pitch,
       last_synced_at = now(), regions = EXCLUDED.regions,
       image_url = EXCLUDED.image_url, merchant_domain = EXCLUDED.merchant_domain,
       discount = EXCLUDED.discount, rating = EXCLUDED.rating,
       rating_count = EXCLUDED.rating_count
     RETURNING (xmax = 0) AS inserted`,
    params
  );
  let inserted = 0;
  for (const r of rows) if (r.inserted) inserted += 1;
  return { inserted, updated: rows.length - inserted };
}

// --- progress checkpoint ---
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
}
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}MB`;
  return `${(n / 1e3).toFixed(0)}KB`;
}

// Reads the header row from the very start of the file, regardless of
// where a resume would start the main read — we always need the column
// names. Returns { header, headerByteLength }.
export async function readHeader(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(65536);
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const text = buf.subarray(0, bytesRead).toString("utf8");
  const nl = text.indexOf("\n");
  if (nl < 0) throw new Error(`could not find a header line in the first 64KB of ${filePath}`);
  const headerLine = text.slice(0, nl + 1);
  const parser = new StreamingCsv();
  const { rows } = parser.feed(headerLine);
  if (!rows.length) throw new Error(`could not parse a header row from ${filePath}`);
  return { header: rows[0].map((h) => h.trim()), headerByteLength: Buffer.byteLength(headerLine, "utf8") };
}

async function importFile(pool, filePath, progress, stats, minPrice) {
  const size = fs.statSync(filePath).size;
  const { header, headerByteLength } = await readHeader(filePath);
  const startOffset = progress[filePath] || headerByteLength;

  if (startOffset >= size) {
    console.log(`[${path.basename(filePath)}] already fully imported (checkpoint at end) — skipping`);
    return;
  }
  console.log(`[${path.basename(filePath)}] starting at byte ${fmtBytes(startOffset)} / ${fmtBytes(size)} (${((startOffset / size) * 100).toFixed(1)}%)`);

  const stream = fs.createReadStream(filePath, { start: startOffset, encoding: "utf8", highWaterMark: 4 * 1024 * 1024 });
  const parser = new StreamingCsv();
  let fileByteOffset = startOffset;   // byte offset in the file where the NEXT chunk starts
  let confirmedOffset = startOffset;  // the latest offset actually safe to resume from (a real row boundary)
  let pendingRows = [];
  let lastLog = Date.now();
  let fileKept = 0, fileInserted = 0, fileUpdated = 0, fileSeen = 0;

  // checkpointAt: the confirmed row-boundary offset to persist once this
  // batch's writes land — passed in explicitly rather than read from the
  // outer scope, since by the time flush() actually awaits the DB call,
  // the main loop may have already advanced confirmedOffset further (past
  // rows this flush doesn't cover yet). Always checkpoint the value that
  // was current when THIS batch was cut, not whatever it's become since.
  async function flush(checkpointAt) {
    if (!pendingRows.length) return;
    const toWrite = pendingRows;
    pendingRows = [];
    const listings = [];
    for (const row of toWrite) {
      fileSeen++;
      const obj = {};
      header.forEach((h, i) => { obj[h] = row[i] ?? ""; });
      if (minPrice > 0) {
        const p = Number(obj.sale_price || obj.price);
        if (!Number.isFinite(p) || p < minPrice) continue;
      }
      const listing = parseProductRow(obj, DEFAULT_CAMPAIGN_ID);
      if (listing) listings.push(listing);
    }
    fileKept += listings.length;
    const { inserted, updated } = await bulkUpsert(pool, listings);
    fileInserted += inserted;
    fileUpdated += updated;
    stats.totalSeen += toWrite.length;
    stats.totalKept += listings.length;
    stats.totalInserted += inserted;
    stats.totalUpdated += updated;

    // Checkpoint AFTER a successful write, at the confirmed row-boundary
    // offset — NEVER the raw end of whatever stream chunk was last read,
    // which is almost never a row boundary. See StreamingCsv.feed()'s
    // comment for why that distinction matters.
    progress[filePath] = checkpointAt;
    saveProgress(progress);
  }

  for await (const chunk of stream) {
    const chunkByteLen = Buffer.byteLength(chunk, "utf8");
    const { rows, lastRowEndIndex } = parser.feed(chunk);
    pendingRows.push(...rows);
    if (lastRowEndIndex >= 0) {
      confirmedOffset = fileByteOffset + Buffer.byteLength(chunk.slice(0, lastRowEndIndex), "utf8");
    }
    fileByteOffset += chunkByteLen;

    if (pendingRows.length >= BATCH_SIZE) await flush(confirmedOffset);

    if (Date.now() - lastLog > LOG_EVERY_MS) {
      const pct = ((fileByteOffset / size) * 100).toFixed(1);
      const elapsedS = (Date.now() - stats.startedAt) / 1000;
      const rate = stats.totalSeen / elapsedS;
      console.log(
        `[${path.basename(filePath)}] ${pct}% (${fmtBytes(fileByteOffset)}/${fmtBytes(size)}) · this file: seen ${fileSeen} kept ${fileKept} ins ${fileInserted} upd ${fileUpdated} · ` +
        `overall: seen ${stats.totalSeen} kept ${stats.totalKept} ins ${stats.totalInserted} upd ${stats.totalUpdated} · ${rate.toFixed(0)} rows/s`
      );
      lastLog = Date.now();
    }
  }
  // A file with no trailing newline leaves its very last row sitting
  // unterminated in the parser's state — the row-detection logic only
  // pushes a row on \n/\r. Flush it as a real row rather than silently
  // dropping the file's last product.
  if (parser.field !== "" || parser.row.length) {
    parser.row.push(parser.field);
    pendingRows.push(parser.row);
  }
  confirmedOffset = fileByteOffset; // end of stream — the whole file up to here is consumed
  await flush(confirmedOffset); // final partial batch
  console.log(`[${path.basename(filePath)}] done — seen ${fileSeen}, kept ${fileKept}, inserted ${fileInserted}, updated ${fileUpdated}`);
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node scripts/import-vcommission-myntra.mjs <file1.csv> [file2.csv ...]");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL env var is required (production Supabase connection string).");
    process.exit(1);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      process.exit(1);
    }
  }

  const minPrice = Number(process.env.MIN_PRODUCT_PRICE || 0);
  const pool = makePool();
  const progress = loadProgress();
  const stats = { totalSeen: 0, totalKept: 0, totalInserted: 0, totalUpdated: 0, startedAt: Date.now() };

  for (const filePath of files) {
    try {
      await importFile(pool, filePath, progress, stats, minPrice);
    } catch (err) {
      console.error(`FILE FAILED (continuing to next file): ${filePath}\n`, err);
    }
  }

  const elapsedMin = ((Date.now() - stats.startedAt) / 60000).toFixed(1);
  console.log(`\nDONE in ${elapsedMin} min — seen ${stats.totalSeen}, kept ${stats.totalKept}, inserted ${stats.totalInserted}, updated ${stats.totalUpdated}`);
  await pool.end();
}

// Only auto-run when executed directly (`node import-vcommission-myntra.mjs
// ...`) — guarded so the pure functions above can also be imported for a
// dry-run test without triggering a real DB-connecting main().
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
}
