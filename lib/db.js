// lib/db.js
//
// Minimal Postgres client. Works with Vercel Postgres, Supabase, Neon, or
// any standard Postgres connection string in DATABASE_URL.
//
// Run the schema below once against your database before first deploy
// (psql $DATABASE_URL -f schema.sql, or paste into your provider's SQL console).

import { Pool } from "pg";
import crypto from "crypto";
import { ENABLE_GERMAN, LOYALTY } from "@/lib/constants";

// While ENABLE_GERMAN is off, listings serving ONLY German-speaking markets
// are invisible everywhere: excluded from the matcher (never recommended),
// the review queue (never shown), bulk actions (never approved unseen), and
// the keyword-enrichment backlog (never enriched in the wrong language).
// Their rows and state are untouched, so re-enabling the flag restores them
// exactly as they were. Regions are uppercased at sync time, so the array
// containment check is safe. Appended to WHERE clauses on `listings`.
const GERMAN_ONLY_FILTER = ENABLE_GERMAN
  ? ""
  : ` AND NOT (regions IS NOT NULL AND cardinality(regions) > 0
              AND regions <@ ARRAY['DE','AT','CH','LI'])`;

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || "";
    const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      // Serverless-friendly settings: keep the pool tiny (each function
      // instance handles one request at a time) and don't let idle
      // connections linger between invocations, which was causing
      // intermittent connection failures under the sync's load.
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      allowExitOnIdle: true,
    });
    // A pool-level error listener prevents an unhandled 'error' event on
    // an idle client from crashing the whole function (FUNCTION_INVOCATION_FAILED).
    pool.on("error", (err) => {
      console.error("Postgres pool error (non-fatal):", err.message);
    });
  }
  return pool;
}

export async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

export async function getApprovedListings() {
  const { rows } = await query(
    `SELECT id, brand, product, price, category, keywords, network, network_link AS "networkLink", pitch, regions
     FROM listings WHERE status = 'approved'`
  );
  return rows;
}

// Paginated. This previously returned EVERY pending listing — fine at a few
// dozen, fatal once a marketplace feed pushes the queue into the thousands:
// the query, the payload and the rendering all grow without limit, and the
// admin page simply never loads. Bulk actions still apply to the whole queue
// server-side; only the display is paged.
export async function getPendingListings({ limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, brand, product, price, category, keywords, network,
            network_link AS "networkLink", pitch, source, created_at AS "createdAt",
            image_url AS "imageUrl", rating, rating_count AS "ratingCount"
     FROM listings WHERE status = 'pending'${GERMAN_ONLY_FILTER}
     ORDER BY created_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

// Total awaiting review, and a per-network breakdown so it's clear what the
// bulk action would actually affect.
export async function countPendingListings() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE network = 'Awin')::int AS awin,
            COUNT(*) FILTER (WHERE network = 'Impact')::int AS impact,
            COUNT(*) FILTER (WHERE network = 'vCommission')::int AS vcommission
     FROM listings WHERE status = 'pending'${GERMAN_ONLY_FILTER}`
  );
  // German-only pendings are deliberately invisible to the queue and to
  // bulk actions while the market is paused — but an inventory count that
  // says "446 pending" next to an empty queue looks like a bug. Count them
  // separately so the UI can SAY where they are instead of hiding them.
  let pausedGerman = 0;
  if (!ENABLE_GERMAN) {
    const paused = await query(
      `SELECT COUNT(*)::int AS n FROM listings
       WHERE status = 'pending'
         AND regions IS NOT NULL AND cardinality(regions) > 0
         AND regions <@ ARRAY['DE','AT','CH','LI']`
    );
    pausedGerman = paused.rows[0].n;
  }
  return { ...rows[0], pausedGerman };
}

export async function insertListing(listing) {
  const { rows } = await query(
    `INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING id`,
    [
      listing.brand,
      listing.product,
      listing.price,
      listing.category,
      listing.keywords,
      listing.network,
      listing.networkLink,
      listing.pitch,
    ]
  );
  return rows[0].id;
}

export async function setListingStatus(id, status) {
  if (!["approved", "rejected", "pending"].includes(status)) {
    throw new Error("Invalid status");
  }
  await query(`UPDATE listings SET status = $1 WHERE id = $2`, [status, id]);
}

// Bulk approve/reject every currently-pending listing, optionally scoped
// to one network. Returns how many rows changed. Only ever touches rows
// that are already pending — never re-opens an approved listing. German-only
// listings are skipped while paused: they're hidden from the queue, and a
// bulk action must never change the status of a row the reviewer can't see.
export async function bulkSetPendingStatus(status, network) {
  if (!["approved", "rejected"].includes(status)) {
    throw new Error("Invalid bulk status");
  }
  const result = network
    ? await query(`UPDATE listings SET status = $1 WHERE status = 'pending' AND network = $2${GERMAN_ONLY_FILTER}`, [status, network])
    : await query(`UPDATE listings SET status = $1 WHERE status = 'pending'${GERMAN_ONLY_FILTER}`, [status]);
  return result.rowCount;
}

export async function insertMicrosite(microsite) {
  await query(
    `INSERT INTO microsites
       (title, summary, task_type, learnings, listing_id, query_hash,
        slug, topic, headline, body, who_for, who_skip, alternatives, country, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      microsite.title,
      microsite.summary,
      microsite.taskType,
      JSON.stringify(microsite.learnings || []),
      microsite.listingId || null,
      microsite.queryHash || null,
      microsite.slug || null,
      microsite.topic || null,
      microsite.headline || null,
      microsite.body || null,
      microsite.whoFor || null,
      microsite.whoSkip || null,
      JSON.stringify(microsite.alternatives || []),
      microsite.country || null,
      // Drafts by default: an answer becomes a public page only after review,
      // the same standard applied to every listing on the platform.
      "draft",
    ]
  );
}

// --- Phase 3: real per-user daily quota ---
//
// identity is a Clerk user ID for signed-in users, or a stable guest ID
// (see lib/guestId.js) for anonymous users. day is always UTC, matching
// the "resets at 00:00 UTC" behavior promised in the product copy.

export async function getAndIncrementUsage(identity) {
  const { rows } = await query(
    `INSERT INTO usage_daily (identity, day, search_count)
     VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
     ON CONFLICT (identity, day)
     DO UPDATE SET search_count = usage_daily.search_count + 1
     RETURNING search_count`,
    [identity]
  );
  return rows[0].search_count;
}

export async function getUsageToday(identity) {
  const { rows } = await query(
    `SELECT search_count FROM usage_daily
     WHERE identity = $1 AND day = (now() AT TIME ZONE 'utc')::date`,
    [identity]
  );
  return rows[0]?.search_count || 0;
}

// --- Phase 3: plan tier lookup, updated by the payment webhook (Razorpay) ---

export async function getUserPlan(userId) {
  if (!userId) return "free";
  const { rows } = await query(`SELECT plan FROM user_plans WHERE user_id = $1`, [userId]);
  return rows[0]?.plan || "free";
}

export async function upsertUserPlan({ userId, plan, subscriptionId }) {
  await query(
    `INSERT INTO user_plans (user_id, plan, subscription_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET plan = $2, subscription_id = $3, updated_at = now()`,
    [userId, plan, subscriptionId || null]
  );
}

// --- Phase: feed ingestion ---
//
// Upserts a normalized listing from a feed sync. New products write as
// 'pending' — exactly the same starting state as a manual brand
// submission, so feed-sourced listings go through the same human review
// gate, never bypassing it. Re-syncing an already-known product (same
// network + externalId) updates its price/details in place without
// resetting its review status — an already-approved listing stays
// approved when its price refreshes; it doesn't go back into the queue.

// Returns the set of external IDs already stored for a network, so the
// sync can SKIP products it already has and advance to new ones each run
// — otherwise every run re-reads the feed from the top and re-imports the
// same first N products, never reaching the rest of a large catalog.
export async function getExistingExternalIds(network) {
  const { rows } = await query(
    `SELECT external_id FROM listings WHERE network = $1 AND external_id IS NOT NULL`,
    [network]
  );
  return new Set(rows.map((r) => r.external_id));
}

export async function upsertFeedListing(network, listing) {
  const { rows } = await query(
    `INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status, source, external_id, last_synced_at, regions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'feed', $9, now(), $10)
     ON CONFLICT (network, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET
       brand = $1, product = $2, price = $3, category = $4,
       -- Preserve AI-enriched keywords, same as the bulk upsert above.
       keywords = CASE WHEN listings.keywords_enriched_at IS NOT NULL
                       THEN listings.keywords ELSE $5 END,
       network_link = $7, pitch = $8, last_synced_at = now(),
       regions = $10
     RETURNING id, (xmax = 0) AS inserted`,
    [
      listing.brand,
      listing.product,
      listing.price,
      listing.category,
      listing.keywords,
      network,
      listing.networkLink,
      listing.pitch,
      listing.externalId,
      listing.regions || null,
    ]
  );
  return { id: rows[0].id, isNew: rows[0].inserted };
}

// Batch upsert: writes many listings in ONE query instead of one round-trip
// per listing. 150 sequential inserts to a remote database was slow enough
// to risk the function being killed; this collapses it to a single insert.
// Returns { inserted, updated } counts.
export async function bulkUpsertFeedListings(network, listings) {
  if (!listings.length) return { inserted: 0, updated: 0 };

  // Postgres allows at most 65535 bind parameters per statement. At 15 columns
  // that's ~4300 rows, so split large batches rather than letting a big sync
  // fail on a limit that only appears at scale.
  const MAX_ROWS_PER_STATEMENT = 400;
  if (listings.length > MAX_ROWS_PER_STATEMENT) {
    let inserted = 0, updated = 0;
    for (let i = 0; i < listings.length; i += MAX_ROWS_PER_STATEMENT) {
      const part = await bulkUpsertFeedListings(network, listings.slice(i, i + MAX_ROWS_PER_STATEMENT));
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
      network, l.networkLink, l.pitch, l.externalId, l.regions || null,
      l.imageUrl || null, l.merchantDomain || null, l.discount || null,
      l.rating ?? null, l.ratingCount ?? null
    );
  });

  const { rows } = await query(
    `INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status, source, external_id, last_synced_at, regions, image_url, merchant_domain, discount, rating, rating_count)
     VALUES ${valueRows.join(", ")}
     ON CONFLICT (network, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET
       brand = EXCLUDED.brand, product = EXCLUDED.product, price = EXCLUDED.price,
       category = EXCLUDED.category,
       -- Keep AI-enriched keywords. Unconditionally taking EXCLUDED.keywords
       -- silently reverted enriched listings to mechanical title-words on
       -- the next hourly sync — undoing paid enrichment within the hour.
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

export async function logSyncRun({ network, status, productsSeen, newListings, updatedListings, errorMessage }) {
  await query(
    `INSERT INTO feed_sync_runs (network, status, products_seen, new_listings, updated_listings, error_message, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [network, status, productsSeen || 0, newListings || 0, updatedListings || 0, errorMessage || null]
  );
}


// Normalizes a report window. Every windowed report function accepts an
// optional { from, to } range (YYYY-MM-DD, inclusive); when absent, the
// days-lookback presets behave exactly as before. Dates are validated here
// once so no query ever sees unchecked input, and the span is capped so a
// typo ("from: 1026-01-01") can't scan years of rows.
export function normalizeRange(days = 30, range = null) {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (range && DATE_RE.test(range.from || "") && DATE_RE.test(range.to || "")) {
    let { from, to } = range;
    if (from > to) [from, to] = [to, from];
    const span = (new Date(to) - new Date(from)) / 86400000;
    if (span >= 0 && span <= 366) return { from, to };
  }
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (Math.max(1, days) - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

// Cumulative inventory per network for the sync panel: how many products a
// network has contributed IN TOTAL and where they stand, next to the per-run
// telemetry — "536 seen this run" means little without "227,041 total,
// 540 approved". German-paused listings are included in these counts on
// purpose: they exist in the inventory, they're just not currently servable.
export async function getInventoryByNetwork() {
  const { rows } = await query(
    `SELECT network,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
     FROM listings
     GROUP BY network
     ORDER BY total DESC`
  );
  return rows;
}

export async function getLatestSyncRuns() {
  const { rows } = await query(
    `SELECT DISTINCT ON (network) network, status, products_seen AS "productsSeen",
            new_listings AS "newListings", updated_listings AS "updatedListings",
            error_message AS "errorMessage", finished_at AS "finishedAt"
     FROM feed_sync_runs
     ORDER BY network, finished_at DESC`
  );
  return rows;
}

// --- Feed cursor: which advertiser feed index to download next ---
// Guarantees the Awin sync downloads exactly one feed per run, advancing
// through the list across runs instead of downloading many at once.
async function ensureSyncStateTable() {
  await query(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`);
}

export async function getFeedCursor(key) {
  try {
    const { rows } = await query(`SELECT value FROM sync_state WHERE key = $1`, [key]);
    return rows[0]?.value ?? 0;
  } catch (err) {
    // Table may not exist yet — create it and start from 0 rather than
    // crashing the whole sync.
    await ensureSyncStateTable();
    return 0;
  }
}

export async function setFeedCursor(key, value) {
  try {
    await query(
      `INSERT INTO sync_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
  } catch (err) {
    await ensureSyncStateTable();
    await query(
      `INSERT INTO sync_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
  }
}

// --- AI keyword enrichment -------------------------------------------------
// Listings whose keywords are missing, empty, or still look like raw title
// fragments benefit from AI-generated shopper keywords. We fetch candidates
// here and write the improved keywords back.
// Only returns listings that have NOT been enriched yet, so each run picks up
// where the last one stopped and works steadily through the whole backlog —
// newest first, then older. Re-running until it reports nothing left covers
// every listing exactly once, rather than repeatedly redoing the newest 100.
//
// While ENABLE_GERMAN is off, listings serving ONLY German-speaking markets
// are deferred, not enriched in English: their keywords_enriched_at stays
// NULL, so the moment German is re-enabled the backlog picks them up and
// enriches them in German as designed (via GERMAN_ONLY_FILTER, top of file).
export async function getListingsNeedingKeywords(limit = 300) {
  const { rows } = await query(
    `SELECT id, brand, product, category, pitch, keywords, regions
     FROM listings
     WHERE status IN ('pending', 'approved')
       AND keywords_enriched_at IS NULL${GERMAN_ONLY_FILTER}
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// How much work is left, so the UI can show progress rather than leaving you
// guessing whether another click is needed. Applies the same German-market
// deferral as the backlog query, so "pending" can actually reach zero instead
// of permanently reporting the deferred German rows.
export async function countListingsNeedingKeywords() {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE keywords_enriched_at IS NULL${GERMAN_ONLY_FILTER}) AS pending,
       COUNT(*) FILTER (WHERE keywords_enriched_at IS NOT NULL) AS done
     FROM listings WHERE status IN ('pending', 'approved')`
  );
  return rows[0];
}

export async function updateListingKeywords(id, keywords) {
  await query(
    `UPDATE listings SET keywords = $1, keywords_enriched_at = now() WHERE id = $2`,
    [keywords, id]
  );
}

// Marks a listing as processed even when the model returned nothing usable —
// otherwise a listing the AI can't improve would be retried forever, costing
// money on every run and blocking the backlog behind it.
export async function markKeywordsAttempted(ids) {
  if (!ids.length) return;
  await query(
    `UPDATE listings SET keywords_enriched_at = now() WHERE id = ANY($1::int[])`,
    [ids]
  );
}

// --- Scalable listing search -----------------------------------------------
// Previously every search loaded ALL approved listings into memory and scored
// them in JavaScript. That's fine for a few hundred rows and untenable once a
// marketplace feed pushes the table into six figures. Postgres now does the
// narrowing with an indexed array-overlap, returning a small candidate set
// that JS scores precisely (stopwords, word boundaries, phrase weighting).
// 200 candidates: at 22K+ approved products a popular word ("tv") matches
// hundreds of rows, and — the subtle part — a single title-weight FTS hit
// produces an IDENTICAL rank for every one of them (verified in production:
// 20 rows, one rank). Ties with no secondary sort return in arbitrary
// order, so a narrow LIMIT was taking an arbitrary slice that could hold
// every TV accessory and no TV. Wide slice + deterministic tie-breakers
// (rating_count as a popularity proxy, then id) make the slice stable and
// sensible. The JS scorer handles 200 rows in microseconds.
export async function findCandidateListings(terms, userCountry, limit = 200) {
  if (!Array.isArray(terms) || terms.length === 0) return [];

  // Full-text branch: single-word terms OR'd into a tsquery. Word pairs
  // ("whey protein") are excluded here — their words are present
  // individually anyway — and each term is reduced to [a-z0-9] so no user
  // input can reach to_tsquery as syntax. FTS brings English stemming
  // ("powders" finds "powder") and frees matching from depending on the
  // keywords array, which is what lets AI keyword enrichment stay off.
  const ftsQuery = terms
    .filter((t) => !t.includes(" "))
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3)
    .join(" | ");

  const { rows } = await query(
    `SELECT id, brand, product, price, category, keywords, network,
            network_link AS "networkLink", pitch, regions,
            image_url AS "imageUrl", merchant_domain AS "merchantDomain", discount,
            rating, rating_count AS "ratingCount"
     FROM listings
     WHERE status = 'approved'
       AND (keywords && $1::text[]
            OR ($4 <> '' AND search_tsv @@ to_tsquery('english', $4)))
       AND ($2::text IS NULL OR regions IS NULL OR $2 = ANY(regions))${GERMAN_ONLY_FILTER}
     ORDER BY (CASE WHEN $4 <> '' THEN ts_rank(search_tsv, to_tsquery('english', $4)) ELSE 0 END) DESC,
              rating_count DESC NULLS LAST, id DESC
     LIMIT $3`,
    [terms, userCountry, limit, ftsQuery]
  );
  return rows;
}

// Single approved listing for the outbound redirect. Applies the German
// pause: a paused listing's link should not work even if someone holds an
// old /out/ URL to it.
export async function getApprovedListingById(id) {
  const { rows } = await query(
    `SELECT id, network, network_link AS "networkLink"
     FROM listings
     WHERE id = $1 AND status = 'approved'${GERMAN_ONLY_FILTER}`,
    [id]
  );
  return rows[0] || null;
}

// One row per outbound click through /out/[listingId]. The click_id in this
// row is what the affiliate network echoes back in its transaction reports —
// see the network_clicks DDL in schema.sql for the full design notes.
export async function recordNetworkClick({ clickId, listingId, network, identity, context, country }) {
  await query(
    `INSERT INTO network_clicks (click_id, listing_id, network, identity, context, country)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clickId, listingId || null, network || null, identity || null, context || null, country || null]
  );
}

// Writes a network-reported conversion onto its click row, matched by the
// click_id we sent out as the sub-ID. Re-polling overwrites: the network's
// latest status wins, which is how pending → approved/declined progresses.
// Returns true when a row was matched. The partial unique index on
// (network, network_transaction_id) makes double-crediting impossible: if
// the same transaction somehow maps to a second click row, the second write
// is skipped rather than crediting the sale twice.
export async function updateClickConversion({ clickId, status, orderValue, commission, currency, transactionId }) {
  if (!clickId) return false;
  try {
    const { rowCount } = await query(
      `UPDATE network_clicks
       SET conversion_status = $2, order_value = $3, commission = $4,
           currency = $5, network_transaction_id = NULLIF($6, ''), matched_at = now()
       WHERE click_id = $1
         AND (network_transaction_id IS NULL OR network_transaction_id = NULLIF($6, ''))`,
      [clickId, status, orderValue, commission, currency, transactionId ?? ""]
    );
    return rowCount > 0;
  } catch (err) {
    if (err.code === "23505") return false; // txn already credited to another click
    throw err;
  }
}

// Revenue rollup for the reports panel. Commission sums are grouped by
// network AND currency because vCommission pays INR while Awin programmes
// pay EUR/GBP — summing across currencies would be a number that means
// nothing. The totals row therefore carries counts only.
export async function getRevenueSummary(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const [totals, byNetwork, daily] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS out_clicks,
         COUNT(*) FILTER (WHERE conversion_status IS NOT NULL) AS conversions,
         COUNT(*) FILTER (WHERE conversion_status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE conversion_status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE conversion_status = 'declined') AS declined
       FROM network_clicks
       WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
    query(
      `SELECT network, COALESCE(currency, '—') AS currency,
         COUNT(*) AS out_clicks,
         COUNT(*) FILTER (WHERE conversion_status IS NOT NULL) AS conversions,
         COALESCE(SUM(order_value) FILTER (WHERE conversion_status IN ('pending','approved')), 0) AS order_value,
         COALESCE(SUM(commission) FILTER (WHERE conversion_status = 'pending'), 0) AS commission_pending,
         COALESCE(SUM(commission) FILTER (WHERE conversion_status = 'approved'), 0) AS commission_approved,
         COALESCE(SUM(commission) FILTER (WHERE conversion_status = 'declined'), 0) AS commission_declined
       FROM network_clicks
       WHERE created_at::date BETWEEN $1::date AND $2::date
       GROUP BY network, currency
       ORDER BY out_clicks DESC`,
      [from, to]
    ),
    query(
      `SELECT d::date AS day,
         COALESCE((SELECT COUNT(*) FROM network_clicks c WHERE c.created_at::date = d::date), 0) AS out_clicks,
         COALESCE((SELECT COUNT(*) FROM network_clicks c WHERE c.created_at::date = d::date AND c.conversion_status IS NOT NULL), 0) AS conversions,
         COALESCE((SELECT SUM(c.commission) FROM network_clicks c WHERE c.created_at::date = d::date AND c.conversion_status IN ('pending','approved')), 0) AS commission
       FROM generate_series($1::date, $2::date, '1 day') d
       ORDER BY day DESC`,
      [from, to]
    ),
  ]);
  return { totals: totals.rows[0], byNetwork: byNetwork.rows, daily: daily.rows };
}

// --- Search query log (anonymous) -------------------------------------------

// Records a search query with NO identity attached — see the search_queries
// DDL for why that is a hard rule, not an implementation detail. Fire-and-
// forget from the research route; logging must never slow or fail a search.
export async function recordSearchQuery({ queryText, matched, listingId, network, country }) {
  const q = String(queryText || "").trim().slice(0, 300);
  if (!q) return;
  await query(
    `INSERT INTO search_queries (query, matched, listing_id, network, country)
     VALUES ($1, $2, $3, $4, $5)`,
    [q, !!matched, listingId || null, network || null, country || null]
  );
}

// The demand signal: what people search, how often, and how often we had
// something to show. The unmatched side of this is the exact list to take
// to the networks — "these are the feeds our shoppers are asking for".
export async function getSearchQueryStats(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const [totals, top, topUnmatched] = await Promise.all([
    query(
      `SELECT COUNT(*) AS searches,
              COUNT(*) FILTER (WHERE matched) AS matched,
              COUNT(DISTINCT lower(trim(query))) AS distinct_queries
       FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
    query(
      `SELECT lower(trim(query)) AS query,
              COUNT(*) AS searches,
              COUNT(*) FILTER (WHERE matched) AS matched,
              MAX(created_at) AS last_seen
       FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date
       GROUP BY 1 ORDER BY searches DESC, last_seen DESC LIMIT 50`,
      [from, to]
    ),
    query(
      `SELECT lower(trim(query)) AS query,
              COUNT(*) AS searches,
              MAX(created_at) AS last_seen,
              MAX(country) AS country
       FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date
         AND matched = false
       GROUP BY 1 ORDER BY searches DESC, last_seen DESC LIMIT 50`,
      [from, to]
    ),
  ]);
  return { totals: totals.rows[0], top: top.rows, topUnmatched: topUnmatched.rows };
}

// Recent raw queries, paginated — for reading the actual phrasing people
// use, which the grouped view flattens.
export async function getRecentSearchQueries(days = 30, page = 1, pageSize = 50, range = null) {
  const { from, to } = normalizeRange(days, range);
  const offset = (Math.max(1, page) - 1) * pageSize;
  const [items, count] = await Promise.all([
    query(
      `SELECT query, matched, network, country, created_at
       FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [from, to, pageSize, offset]
    ),
    query(
      `SELECT COUNT(*) AS total FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
  ]);
  return { items: items.rows, total: Number(count.rows[0].total) };
}

// --- Product browser ---------------------------------------------------------

// Approved products of one network, paginated — the admin's view of what
// can actually be served to shoppers. Paginated without exception (rule #2:
// unbounded result sets have collapsed this app before). Optionally
// filtered to one category, driving the category pills in the browser.
export async function getApprovedListingsByNetwork(network, page = 1, pageSize = 50, category = null) {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const [items, count] = await Promise.all([
    query(
      `SELECT id, brand, product, price, category, keywords, regions,
              rating, rating_count AS "ratingCount", image_url AS "imageUrl",
              merchant_domain AS "merchantDomain", discount,
              network_link AS "networkLink", created_at
       FROM listings
       WHERE status = 'approved' AND network = $1
         AND ($4::text IS NULL OR category = $4)
       ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [network, pageSize, offset, category]
    ),
    query(
      `SELECT COUNT(*) AS total FROM listings
       WHERE status = 'approved' AND network = $1
         AND ($2::text IS NULL OR category = $2)`,
      [network, category]
    ),
  ]);
  return { items: items.rows, total: Number(count.rows[0].total) };
}

// Category breakdown of a network's approved products — what the inventory
// actually consists of, in the site's own taxonomy (electronics, fashion,
// health, ...) assigned at sync time by mapCategory.
export async function getCategoriesForNetwork(network) {
  const { rows } = await query(
    `SELECT COALESCE(category, 'other') AS category, COUNT(*) AS total
     FROM listings
     WHERE status = 'approved' AND network = $1
     GROUP BY 1 ORDER BY total DESC`,
    [network]
  );
  return rows;
}

// Performance rolled up by category: what KIND of products get clicked and
// sell, which is the level at which feed-request and approval decisions are
// actually made. Grouped by category AND currency for the same reason as
// the network revenue rollup — INR and EUR must never be summed together.
export async function getPerformanceByCategory(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const { rows } = await query(
    `SELECT COALESCE(l.category, 'other') AS category,
            MAX(c.currency) AS currency,
            COUNT(c.*) AS clicks,
            COUNT(*) FILTER (WHERE c.conversion_status IS NOT NULL) AS conversions,
            COUNT(*) FILTER (WHERE c.conversion_status = 'approved') AS approved,
            COALESCE(SUM(c.commission) FILTER (WHERE c.conversion_status IN ('pending','approved')), 0) AS commission
     FROM network_clicks c
     JOIN listings l ON l.id = c.listing_id
     WHERE c.created_at::date BETWEEN $1::date AND $2::date
     GROUP BY 1
     ORDER BY conversions DESC, clicks DESC`,
    [from, to]
  );
  return rows;
}

// Inventory split by category, for the reports panel and export — the
// companion to the country split: WHAT we have, next to WHERE we can
// serve it.
export async function getInventoryByCategory() {
  const { rows } = await query(
    `SELECT COALESCE(category, 'other') AS category,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending
     FROM listings
     GROUP BY 1
     ORDER BY total DESC`
  );
  return rows;
}

// --- Product performance ------------------------------------------------------

// Which products actually get clicked and which actually sell — the ground
// truth that query counts can only hint at. Built entirely from the click
// plumbing: every /out/ click is a row in network_clicks, and the conversion
// poll fills in what the networks confirmed. Commission/order sums are per
// row currency (MAX(currency) is a display hint — a single product converts
// in one currency in practice). Paginated (rule #2).
export async function getProductPerformance(days = 30, page = 1, pageSize = 50, range = null) {
  const { from, to } = normalizeRange(days, range);
  const offset = (Math.max(1, page) - 1) * pageSize;
  const [items, count] = await Promise.all([
    query(
      `SELECT l.id, l.brand, l.product, l.network, l.price,
              l.image_url AS "imageUrl",
              COUNT(c.*) AS clicks,
              COUNT(*) FILTER (WHERE c.conversion_status IS NOT NULL) AS conversions,
              COUNT(*) FILTER (WHERE c.conversion_status = 'approved') AS approved,
              COUNT(*) FILTER (WHERE c.conversion_status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE c.conversion_status = 'declined') AS declined,
              COALESCE(SUM(c.commission) FILTER (WHERE c.conversion_status IN ('pending','approved')), 0) AS commission,
              COALESCE(SUM(c.order_value) FILTER (WHERE c.conversion_status IN ('pending','approved')), 0) AS order_value,
              MAX(c.currency) AS currency
       FROM network_clicks c
       JOIN listings l ON l.id = c.listing_id
       WHERE c.created_at::date BETWEEN $1::date AND $2::date
       GROUP BY l.id, l.brand, l.product, l.network, l.price, l.image_url
       ORDER BY conversions DESC, clicks DESC, l.id DESC
       LIMIT $3 OFFSET $4`,
      [from, to, pageSize, offset]
    ),
    query(
      `SELECT COUNT(DISTINCT c.listing_id) AS total
       FROM network_clicks c
       WHERE c.created_at::date BETWEEN $1::date AND $2::date
         AND c.listing_id IS NOT NULL`,
      [from, to]
    ),
  ]);
  return { items: items.rows, total: Number(count.rows[0].total) };
}

// Inventory split by country. A listing serving several countries counts
// once per country (so the column can sum past the listing count — that is
// the honest way to answer "what can we serve in X"); listings with no
// region data are unrestricted and grouped as such.
export async function getInventoryByCountry() {
  const { rows } = await query(
    `SELECT COALESCE(r.region, 'Unrestricted') AS country,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE l.status = 'approved') AS approved,
            COUNT(*) FILTER (WHERE l.status = 'pending') AS pending
     FROM listings l
     LEFT JOIN LATERAL unnest(l.regions) AS r(region) ON true
     GROUP BY 1
     ORDER BY total DESC
     LIMIT 30`
  );
  return rows;
}

// --- Loyalty programme --------------------------------------------------------

// Enrols a signed-in user. Consent timestamp matters: only clicks made
// AFTER this moment ever accrue points — enforced in the earning query.
export async function joinLoyalty(userId) {
  await query(
    `INSERT INTO loyalty_members (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// The earning engine. Runs set-based after every conversion poll: every
// converted click belonging to a member (and made after they consented)
// gets a ledger entry whose status mirrors the network's word — pending /
// confirmed / reversed — and whose points derive from the commission at
// LOYALTY.POINTS_RATE, doubled for Plus. Re-polls update in place (the
// click_id unique key), so pending → confirmed/reversed progresses and a
// late commission adjustment recomputes the points. INR only, by design.
export async function syncLoyaltyLedger() {
  const { rowCount } = await query(
    `INSERT INTO points_ledger (user_id, click_id, points, status, commission, currency, network, listing_id)
     SELECT c.identity, c.click_id,
            ROUND(c.commission * $1 * CASE WHEN up.plan = 'plus' THEN $2 ELSE 1 END, 2),
            CASE c.conversion_status WHEN 'approved' THEN 'confirmed'
                                     WHEN 'declined' THEN 'reversed'
                                     ELSE 'pending' END,
            c.commission, c.currency, c.network, c.listing_id
     FROM network_clicks c
     JOIN loyalty_members m ON m.user_id = c.identity AND c.created_at >= m.consented_at
     LEFT JOIN user_plans up ON up.user_id = c.identity
     WHERE c.conversion_status IS NOT NULL
       AND COALESCE(c.currency, 'INR') = 'INR'
       AND c.commission > 0
     ON CONFLICT (click_id) DO UPDATE SET
       status = EXCLUDED.status,
       points = EXCLUDED.points,
       commission = EXCLUDED.commission,
       updated_at = now()
     WHERE points_ledger.status IS DISTINCT FROM EXCLUDED.status
        OR points_ledger.points IS DISTINCT FROM EXCLUDED.points`,
    [LOYALTY.POINTS_RATE, LOYALTY.PLUS_MULTIPLIER]
  );
  return rowCount;
}

// Everything the Rewards tab shows in one call. Available balance is
// confirmed points minus every redemption that isn't rejected — a REQUESTED
// redemption holds its points immediately, so the same balance can't be
// spent twice while an admin fulfils it.
export async function getRewardsSummary(userId) {
  const [member, balances, ledger, redemptions, plan, searchToday] = await Promise.all([
    query(`SELECT consented_at FROM loyalty_members WHERE user_id = $1`, [userId]),
    query(
      `SELECT
         COALESCE(SUM(points) FILTER (WHERE status = 'confirmed'), 0) AS confirmed,
         COALESCE(SUM(points) FILTER (WHERE status = 'pending'), 0) AS pending,
         COALESCE((SELECT SUM(points) FROM redemptions r
                   WHERE r.user_id = $1 AND r.status <> 'rejected'), 0) AS held_or_redeemed
       FROM points_ledger WHERE user_id = $1`,
      [userId]
    ),
    query(
      `SELECT pl.points, pl.status, pl.source, pl.note, pl.network, pl.created_at, pl.updated_at, l.product, l.brand
       FROM points_ledger pl LEFT JOIN listings l ON l.id = pl.listing_id
       WHERE pl.user_id = $1 ORDER BY pl.created_at DESC LIMIT 50`,
      [userId]
    ),
    query(
      `SELECT id, points, voucher_type, status, voucher_code, created_at, fulfilled_at
       FROM redemptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    ),
    query(`SELECT plan FROM user_plans WHERE user_id = $1`, [userId]),
    query(
      `SELECT COALESCE(SUM(points), 0) AS today FROM points_ledger
       WHERE user_id = $1 AND source IN ('search', 'click')
         AND created_at::date = (now() AT TIME ZONE 'utc')::date`,
      [userId]
    ),
  ]);
  const b = balances.rows[0];
  return {
    isMember: member.rows.length > 0,
    memberSince: member.rows[0]?.consented_at || null,
    confirmed: Number(b.confirmed),
    pending: Number(b.pending),
    available: Math.max(0, Math.floor(Number(b.confirmed) - Number(b.held_or_redeemed))),
    ledger: ledger.rows,
    redemptions: redemptions.rows,
    plan: plan.rows[0]?.plan || "free",
    searchPointsToday: Number(searchToday.rows[0].today),
  };
}

// Race-safe redemption: the balance check and the insert are ONE statement,
// so two concurrent requests cannot both pass a stale balance check. Returns
// true when the redemption was created.
export async function requestRedemption(userId, points, voucherType) {
  // Redemption is the paid feature: accumulate free, redeem as Plus. The
  // plan check lives inside the same statement as the balance check.
  const { rowCount } = await query(
    `INSERT INTO redemptions (user_id, points, voucher_type)
     SELECT $1, $2::int, $3
     WHERE EXISTS (SELECT 1 FROM user_plans WHERE user_id = $1 AND plan = 'plus')
       AND (
       SELECT COALESCE(SUM(points) FILTER (WHERE status = 'confirmed'), 0)
            - COALESCE((SELECT SUM(points) FROM redemptions r
                        WHERE r.user_id = $1 AND r.status <> 'rejected'), 0)
       FROM points_ledger WHERE user_id = $1
     ) >= $2::int`,
    [userId, points, voucherType]
  );
  return rowCount > 0;
}

// Credits search points to a REGISTERED user — every pick earns, no
// separate cap: the daily pick quota is the ceiling (decision 2026-07-23).
// One ledger row per search (source='search', immediately confirmed —
// there's no network to wait for).
export async function creditSearchPoints(userId) {
  const per = LOYALTY.SEARCH_POINTS.USER_PER_PICK;
  // ONE statement: the capped insert and today's running total together.
  // The trailing SELECT reads the pre-insert snapshot, so the CTE's points
  // are added back explicitly. Also fixes an earlier bug where a capped
  // credit still reported "earned" to the UI.
  const { rows } = await query(
    `WITH ins AS (
       INSERT INTO points_ledger (user_id, points, status, source, note)
       SELECT $1, $2, 'confirmed', 'search', 'search pick'
       WHERE (
         SELECT COALESCE(SUM(points), 0) FROM points_ledger
         WHERE user_id = $1 AND source IN ('search', 'click')
       ) + $2 <= $3
       RETURNING points
     )
     SELECT
       COALESCE((SELECT points FROM ins), 0) AS earned,
       COALESCE((SELECT SUM(points) FROM points_ledger
                 WHERE user_id = $1 AND source IN ('search', 'click')
                   AND created_at::date = (now() AT TIME ZONE 'utc')::date), 0)
       + COALESCE((SELECT points FROM ins), 0) AS today_total`,
    [userId, per, LOYALTY.ENGAGEMENT_POINTS_LIFETIME_CAP]
  );
  const earned = Number(rows[0].earned);
  return { earned, todayTotal: Number(rows[0].today_total), capped: earned === 0 };
}

// Credits click points when a signed-in user follows an affiliate link —
// the action closest to revenue earns the most. ONE credit per product per
// day: the note carries listing+date and the WHERE makes repeat clicks on
// the same card a no-op, otherwise this would be a self-service points
// mint. Returns points credited (0 on the dedupe path).
export async function creditClickPoints(userId, listingId) {
  const per = LOYALTY.SEARCH_POINTS.CLICK_POINTS;
  const { rowCount } = await query(
    `INSERT INTO points_ledger (user_id, points, status, source, note, listing_id)
     SELECT $1, $2, 'confirmed', 'click', 'click:' || $3 || ':' || (now() AT TIME ZONE 'utc')::date, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM points_ledger
       WHERE user_id = $1 AND source = 'click'
         AND note = 'click:' || $3 || ':' || (now() AT TIME ZONE 'utc')::date
     )
     AND (
       SELECT COALESCE(SUM(points), 0) FROM points_ledger
       WHERE user_id = $1 AND source IN ('search', 'click')
     ) + $2 <= $4`,
    [userId, per, listingId, LOYALTY.ENGAGEMENT_POINTS_LIFETIME_CAP]
  );
  return rowCount > 0 ? per : 0;
}

// Guest day points are VIRTUAL — computed from today's pick count, never
// stored, gone at midnight by construction. This returns today's figure
// for display after a guest search.
export async function getGuestDayPoints(guestIdentity) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(search_count), 0) AS picks FROM usage_daily
     WHERE identity = $1 AND day = (now() AT TIME ZONE 'utc')::date`,
    [guestIdentity]
  );
  return Number(rows[0].picks) * LOYALTY.SEARCH_POINTS.GUEST_PER_PICK;
}

// The registration hook: a newly signed-in user carries their old guest
// cookie, so TODAY's guest points convert into real ledger points, once.
// The note carries the date, and the WHERE makes the claim idempotent —
// re-calls the same day insert nothing.
export async function claimGuestDayPoints(userId, guestIdentity) {
  if (!guestIdentity) return 0;
  const points = await getGuestDayPoints(guestIdentity);
  if (points <= 0) return 0;
  const { rowCount } = await query(
    `INSERT INTO points_ledger (user_id, points, status, source, note)
     SELECT $1, $2, 'confirmed', 'search', 'guest day claim ' || (now() AT TIME ZONE 'utc')::date
     WHERE NOT EXISTS (
       SELECT 1 FROM points_ledger
       WHERE user_id = $1 AND source = 'search'
         AND note = 'guest day claim ' || (now() AT TIME ZONE 'utc')::date
     )`,
    [userId, points]
  );
  return rowCount > 0 ? points : 0;
}

// Internal rewards report for the Reports tab and export: issuance by
// source, outstanding liability (confirmed minus redeemed — the number the
// business owes), and redemption totals by voucher brand. The provider-side
// (Woohoo/Qwikcilver) report comes from their dashboard once integrated;
// this internal view is the ground truth for reconciliation either way.
export async function getRewardsReport() {
  const [issuance, liability, byVoucher] = await Promise.all([
    query(
      `SELECT source, status, COUNT(*) AS entries, COALESCE(SUM(points), 0) AS points
       FROM points_ledger GROUP BY source, status ORDER BY source, status`
    ),
    query(
      `SELECT
         COALESCE((SELECT SUM(points) FROM points_ledger WHERE status = 'confirmed'), 0)
       - COALESCE((SELECT SUM(points) FROM redemptions WHERE status <> 'rejected'), 0) AS outstanding,
         (SELECT COUNT(DISTINCT user_id) FROM loyalty_members) AS members`
    ),
    query(
      `SELECT voucher_type, status, COUNT(*) AS redemptions, COALESCE(SUM(points), 0) AS points_value
       FROM redemptions GROUP BY voucher_type, status ORDER BY points_value DESC`
    ),
  ]);
  const feedback = await query(
    `SELECT kind, block_number, status, feedback, created_at, LEFT(user_id, 14) AS user_prefix
     FROM user_checkpoints WHERE feedback IS NOT NULL
     ORDER BY created_at DESC LIMIT 15`
  );
  return {
    issuance: issuance.rows,
    outstandingPoints: Number(liability.rows[0].outstanding),
    members: Number(liability.rows[0].members),
    byVoucher: byVoucher.rows,
    feedback: feedback.rows,
  };
}

// The lifecycle engine — the full matrix (design 2026-07-23 v3).
//
// Per cycle (a cycle = since the last confirmed purchase; recharges also
// move the anchor), for ANY identity including guests:
//   Trigger A ("value without monetization intent"): 50 searches with ZERO
//     affiliate clicks, OR 50 alternative-link clicks with zero affiliate
//     clicks, OR — the evasion ceiling — 2× the search limit regardless.
//   Trigger B: 25 affiliate clicks without a purchase.
// Consequences ladder:
//   Guests & free users — first trip in a cycle: blocking UPGRADE
//     interstitial (acknowledgeable: "continue for now" records a prompt
//     checkpoint). Second trip, same cycle: hard INCREASE USAGE gate.
//   Plus — never blocked from research; instead ALTERNATIVES are withheld
//     (queries and sponsored matches continue) until a purchase resets.
// Purchases reset everyone. IP limits (below) backstop identity-hopping.
export async function getLifecycleStatus(identity) {
  const L = LOYALTY.GATE_LIMITS.free; // thresholds are the same for every tier

  // ONE round trip (consolidated 2026-07-27, was three). The anchor is a
  // CTE the rest of the query reads from, so plan, counters, prompts and
  // credit status all resolve in a single statement. Database operations
  // are a metered resource — every avoidable round trip is real money at
  // campaign volume.
  const { rows } = await query(
    `WITH anchor AS (
       SELECT GREATEST(
         COALESCE((SELECT MAX(COALESCE(matched_at, created_at)) FROM network_clicks
                   WHERE identity = $1 AND conversion_status = 'approved'), 'epoch'),
         COALESCE((SELECT MAX(created_at) FROM user_checkpoints
                   WHERE user_id = $1 AND status = 'paid'), 'epoch')
       ) AS ts
     )
     SELECT
       (SELECT plan FROM user_plans WHERE user_id = $1) AS plan,
       COALESCE((SELECT SUM(search_count) FROM usage_daily
                 WHERE identity = $1 AND day >= a.ts::date), 0) AS searches_since,
       (SELECT COUNT(*) FROM network_clicks WHERE identity = $1 AND created_at > a.ts) AS aff_clicks,
       (SELECT COUNT(*) FROM alt_clicks WHERE identity = $1 AND created_at > a.ts) AS alt_clicks,
       (SELECT COUNT(*) FROM user_checkpoints
        WHERE user_id = $1 AND kind = 'prompt' AND created_at > a.ts) AS prompts,
       (EXISTS(SELECT 1 FROM user_checkpoints WHERE user_id = $1 AND status = 'paid')
        OR EXISTS(SELECT 1 FROM network_clicks
                  WHERE identity = $1 AND conversion_status = 'approved')) AS has_credit
     FROM anchor a`,
    [identity]
  );
  const r = rows[0];
  const isPlus = r.plan === "plus";
  const searches = Number(r.searches_since);
  const affClicks = Number(r.aff_clicks);
  const altClicks = Number(r.alt_clicks);
  const prompts = Number(r.prompts);

  const trigA =
    (searches >= L.searches && affClicks === 0) ||
    (altClicks >= L.searches && affClicks === 0) ||
    searches >= L.searches * 2; // token-click evasion ceiling
  const trigB = affClicks >= L.clicks;
  const triggered = trigA || trigB;

  return {
    searches,
    affClicks,
    altClicks,
    isPlus,
    plan: r.plan || "free",   // reused by callers so they skip getUserPlan
    hasCredit: r.has_credit === true,
    suppressAlternatives: isPlus && triggered,
    stage: !isPlus && triggered ? (prompts === 0 ? "upgrade" : "recharge") : null,
    trigger: triggered ? (trigB ? "clicks" : "searches") : null,
  };
}

// Atomic quota check-and-consume: ONE statement replaces the old
// read-then-increment pair, which the code itself flagged as non-atomic
// (two simultaneous requests at the limit could both slip through). The
// ON CONFLICT ... WHERE only increments while under the limit, so a
// blocked request returns no row and consumes nothing.
export async function checkAndConsumeQuota(identity, limit) {
  const { rows, rowCount } = await query(
    `INSERT INTO usage_daily (identity, day, search_count)
     VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
     ON CONFLICT (identity, day) DO UPDATE
       SET search_count = usage_daily.search_count + 1
       WHERE usage_daily.search_count < $2
     RETURNING search_count`,
    [identity, limit]
  );
  return { allowed: rowCount > 0, used: rows[0]?.search_count ?? limit };
}

// Everything the header needs in ONE query (was three): plan, today's
// picks, and the points balance. Guest day-points need no separate query
// at all — they're today's pick count times the per-pick rate.
export async function getHeaderSnapshot(identity, userId) {
  const { rows } = await query(
    `SELECT
       (SELECT plan FROM user_plans WHERE user_id = $2) AS plan,
       COALESCE((SELECT search_count FROM usage_daily
                 WHERE identity = $1 AND day = (now() AT TIME ZONE 'utc')::date), 0) AS used,
       COALESCE((SELECT SUM(points) FROM points_ledger
                 WHERE user_id = $2 AND status = 'confirmed'), 0)
       - COALESCE((SELECT SUM(points) FROM redemptions
                   WHERE user_id = $2 AND status <> 'rejected'), 0) AS balance,
       COALESCE((SELECT SUM(points) FROM points_ledger
                 WHERE user_id = $2 AND status = 'pending'), 0) AS pending`,
    [identity, userId || null]
  );
  const r = rows[0];
  return {
    plan: r.plan || "free",
    used: Number(r.used),
    balance: Math.max(0, Math.floor(Number(r.balance))),
    pending: Math.floor(Number(r.pending)),
  };
}

// --- IP-level fair use (hashed, rolling window) ------------------------------
const IP_SALT = "sllm-ip-fairuse-v1"; // constant salt: correlation within our
// own table only; the hash is one-way and raw IPs are never stored.

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(IP_SALT + String(ip)).digest("hex").slice(0, 32);
}

export async function recordIpActivity(ipHash, kind) {
  if (!ipHash) return;
  const col = kind === "click" ? "clicks" : "searches";
  await query(
    `INSERT INTO ip_activity (ip_hash, day, ${col}) VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
     ON CONFLICT (ip_hash, day) DO UPDATE SET ${col} = ip_activity.${col} + 1`,
    [ipHash]
  );
}

// Record this hit AND return the rolling-window totals in one round trip.
// The data-modifying CTE always executes (Postgres guarantees this even
// when its output isn't read); the SELECT sees the pre-insert snapshot, so
// the window total lags by exactly this request — immaterial against
// thresholds in the hundreds, and worth one saved operation per search.
export async function recordAndCheckIp(ipHash, kind) {
  if (!ipHash) return { searchGated: false, clickGated: false };
  const col = kind === "click" ? "clicks" : "searches";
  const { rows } = await query(
    `WITH bump AS (
       INSERT INTO ip_activity (ip_hash, day, ${col})
       VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
       ON CONFLICT (ip_hash, day) DO UPDATE SET ${col} = ip_activity.${col} + 1
       RETURNING 1
     )
     SELECT COALESCE(SUM(searches), 0) AS s, COALESCE(SUM(clicks), 0) AS c
     FROM ip_activity
     WHERE ip_hash = $1 AND day >= (now() AT TIME ZONE 'utc')::date - $2::int`,
    [ipHash, LOYALTY.IP_GATE.windowDays]
  );
  return {
    searchGated: Number(rows[0].s) >= LOYALTY.IP_GATE.searches,
    clickGated: Number(rows[0].c) >= LOYALTY.IP_GATE.clicks,
  };
}

export async function resolveCheckpoint(userId, kind, status, feedback = null) {
  // block_number is a per-(user,kind) sequence — computed in the insert so
  // it can't race, and the unique key makes webhook retries no-op only if
  // they collide, which a same-instant retry would.
  const { rowCount } = await query(
    `INSERT INTO user_checkpoints (user_id, kind, block_number, status, feedback)
     SELECT $1, $2,
            COALESCE((SELECT MAX(block_number) FROM user_checkpoints WHERE user_id = $1 AND kind = $2), 0) + 1,
            $3, $4
     ON CONFLICT (user_id, kind, block_number) DO NOTHING`,
    [userId, kind, status, feedback ? String(feedback).slice(0, 2000) : null]
  );
  return rowCount > 0;
}

// Lightweight points figure for the site header — polled with /api/usage
// after every search, so it must stay a single cheap query, not the full
// getRewardsSummary. For users: total confirmed points minus non-rejected
// redemptions (what they'd see as "their points"). Guests use
// getGuestDayPoints (virtual, from today's pick count).
export async function getHeaderPoints(userId) {
  const { rows } = await query(
    `SELECT COALESCE((SELECT SUM(points) FROM points_ledger WHERE user_id = $1 AND status = 'confirmed'), 0)
          - COALESCE((SELECT SUM(points) FROM redemptions WHERE user_id = $1 AND status <> 'rejected'), 0) AS balance,
          COALESCE((SELECT SUM(points) FROM points_ledger WHERE user_id = $1 AND status = 'pending'), 0) AS pending`,
    [userId]
  );
  return { balance: Math.max(0, Math.floor(Number(rows[0].balance))), pending: Math.floor(Number(rows[0].pending)) };
}

// Admin: the manual fulfilment queue. Requested first, then recent history.
export async function getRedemptionQueue() {
  const { rows } = await query(
    `SELECT id, user_id, points, voucher_type, status, voucher_code, created_at, fulfilled_at
     FROM redemptions
     ORDER BY (status = 'requested') DESC, created_at DESC LIMIT 100`
  );
  return rows;
}

// Fulfil with a voucher code, or reject (which returns the held points to
// the member's available balance automatically, since available excludes
// only non-rejected redemptions). Only 'requested' rows can transition.
export async function resolveRedemption(id, action, voucherCode = null) {
  if (action === "fulfill") {
    const { rowCount } = await query(
      `UPDATE redemptions SET status = 'fulfilled', voucher_code = $2, fulfilled_at = now()
       WHERE id = $1 AND status = 'requested'`,
      [id, voucherCode]
    );
    return rowCount > 0;
  }
  if (action === "reject") {
    const { rowCount } = await query(
      `UPDATE redemptions SET status = 'rejected', fulfilled_at = now()
       WHERE id = $1 AND status = 'requested'`,
      [id]
    );
    return rowCount > 0;
  }
  return false;
}

export async function recordAltClick({ brand, product, identity, context }) {
  await query(
    `INSERT INTO alt_clicks (brand, product, identity, context) VALUES ($1, $2, $3, $4)`,
    [brand, product, identity, context]
  );
}

// Clicks by day and type over a range: sponsored (network_clicks) vs
// alternative (alt_clicks) side by side — the daily picture of where
// attention goes. Plus the brand-manager sheet: alternative demand ranked
// by clicks per brand+product.
export async function getClicksReport(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const [byDay, altDemand, queriesByDay] = await Promise.all([
    query(
      `SELECT d::date AS day,
         COALESCE((SELECT COUNT(*) FROM network_clicks c WHERE c.created_at::date = d::date), 0) AS sponsored_clicks,
         COALESCE((SELECT COUNT(*) FROM alt_clicks a WHERE a.created_at::date = d::date), 0) AS alternative_clicks
       FROM generate_series($1::date, $2::date, '1 day') d
       ORDER BY day DESC`,
      [from, to]
    ),
    query(
      `SELECT COALESCE(brand, '—') AS brand, product, COUNT(*) AS clicks,
              MIN(created_at)::date AS first_seen, MAX(created_at)::date AS last_seen
       FROM alt_clicks
       WHERE created_at::date BETWEEN $1::date AND $2::date
       GROUP BY brand, product
       ORDER BY clicks DESC
       LIMIT 100`,
      [from, to]
    ),
    query(
      `SELECT created_at::date AS day, query_text, matched
       FROM search_queries
       WHERE created_at::date BETWEEN $1::date AND $2::date
       ORDER BY created_at DESC
       LIMIT 5000`,
      [from, to]
    ),
  ]);
  return { byDay: byDay.rows, altDemand: altDemand.rows, queriesByDay: queriesByDay.rows, range: { from, to } };
}

// App-install adoption. No new table: the events table already carries
// event_type + identity + day with the right indexes. Installs are counted
// as unique identities, not raw events, since one person reinstalling
// shouldn't read as growth.
export async function getPwaStats(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const [totals, daily, visitors] = await Promise.all([
    query(
      `SELECT event_type, COUNT(*) AS events, COUNT(DISTINCT identity) AS people
       FROM events
       WHERE event_type LIKE 'pwa_%' AND day BETWEEN $1::date AND $2::date
       GROUP BY event_type`,
      [from, to]
    ),
    query(
      `SELECT d::date AS day,
         COALESCE((SELECT COUNT(*) FROM events e
                   WHERE e.event_type = 'pwa_installed' AND e.day = d::date), 0) AS installs,
         COALESCE((SELECT COUNT(DISTINCT identity) FROM events e
                   WHERE e.event_type = 'pwa_standalone_visit' AND e.day = d::date), 0) AS app_users
       FROM generate_series($1::date, $2::date, '1 day') d
       ORDER BY day DESC`,
      [from, to]
    ),
    // The denominator: unique visitors in the same window.
    query(
      `SELECT COUNT(DISTINCT identity) AS people FROM events
       WHERE event_type = 'visit' AND day BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
  ]);
  const byType = Object.fromEntries(
    totals.rows.map((r) => [r.event_type, { events: Number(r.events), people: Number(r.people) }])
  );
  const visitorCount = Number(visitors.rows[0].people);
  const installs = byType.pwa_installed?.events || 0;
  const appUsers = byType.pwa_standalone_visit?.people || 0;
  const rate = (n) => (visitorCount > 0 ? Math.round((n / visitorCount) * 1000) / 10 : null);
  return {
    installs,
    appUsers,
    appSessions: byType.pwa_standalone_visit?.events || 0,
    dismissed: byType.pwa_prompt_dismissed?.events || 0,
    visitors: visitorCount,
    // Per 100 unique visitors in the same window. Two rates, because the
    // denominators differ in honesty: installs are Android/desktop-only
    // (iOS fires no install event) while visitors include iPhones, so
    // installRate UNDERSTATES adoption. appUserRate counts every platform
    // and is the number to trust.
    installRate: rate(installs),
    appUserRate: rate(appUsers),
    daily: daily.rows,
  };
}

// --- Analytics -------------------------------------------------------------

export async function recordEvent({ eventType, identity, listingId, network, country, utm }) {
  if (!eventType) return;
  await query(
    `INSERT INTO events (event_type, identity, listing_id, network, country,
                         utm_source, utm_medium, utm_campaign, referrer_host)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      eventType, identity || null, listingId || null, network || null, country || null,
      utm?.source || null, utm?.medium || null, utm?.campaign || null, utm?.referrerHost || null,
    ]
  );
}

// Where visitors came from — the report that replaces what you'd otherwise
// install Google Analytics for.
export async function getTrafficSources(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const { rows } = await query(
    `SELECT
       COALESCE(utm_source, referrer_host, 'direct') AS source,
       utm_medium AS medium,
       utm_campaign AS campaign,
       COUNT(DISTINCT identity) AS visitors,
       COUNT(*) AS visits
     FROM events
     WHERE event_type = 'visit' AND day BETWEEN $1::date AND $2::date
     GROUP BY 1, 2, 3
     ORDER BY visitors DESC
     LIMIT 40`,
    [from, to]
  );
  return rows;
}

// Campaign performance end to end: visitors, searches they ran, and clicks
// on partner products. This is what tells you whether an ad campaign paid
// for itself, which raw visitor counts never will.
export async function getCampaignPerformance(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const { rows } = await query(
    `WITH first_touch AS (
       SELECT DISTINCT ON (identity) identity,
              COALESCE(utm_source, referrer_host, 'direct') AS source,
              utm_campaign AS campaign
       FROM events
       WHERE event_type = 'visit' AND day BETWEEN $1::date AND $2::date
       ORDER BY identity, created_at ASC
     )
     SELECT f.source, f.campaign,
            COUNT(DISTINCT f.identity) AS visitors,
            COALESCE(SUM(u.searches), 0) AS searches,
            COALESCE(SUM(c.clicks), 0) AS affiliate_clicks
     FROM first_touch f
     LEFT JOIN (SELECT identity, SUM(search_count) AS searches FROM usage_daily GROUP BY identity) u
       ON u.identity = f.identity
     LEFT JOIN (SELECT identity, COUNT(*) AS clicks FROM events WHERE event_type = 'affiliate_click' GROUP BY identity) c
       ON c.identity = f.identity
     GROUP BY f.source, f.campaign
     ORDER BY visitors DESC
     LIMIT 30`,
    [from, to]
  );
  return rows;
}

// Everything the reports panel needs, in one round trip per section.
export async function getReportSummary(days = 30, range = null) {
  const { from, to } = normalizeRange(days, range);
  const [totals, daily, topProducts, byNetwork, topUsers, activity, plans, inventory, sources, campaigns, revenue, inventoryByCountry, inventoryByCategory, rewardsReport, clicksReport, pwaStats] =
    await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(DISTINCT identity) FROM events WHERE event_type = 'visit') AS total_visitors,
           (SELECT COUNT(*) FROM user_plans) AS registered_users,
           (SELECT COALESCE(SUM(search_count), 0) FROM usage_daily) AS total_searches,
           (SELECT COUNT(*) FROM events WHERE event_type = 'affiliate_click') AS total_clicks,
           (SELECT COUNT(*) FROM events WHERE event_type = 'no_match') AS no_match_searches,
           (SELECT COUNT(*) FROM events WHERE event_type = 'limit_reached') AS limit_hits`
      ),
      query(
        `SELECT d::date AS day,
           COALESCE((SELECT SUM(search_count) FROM usage_daily u WHERE u.day = d::date), 0) AS searches,
           COALESCE((SELECT COUNT(DISTINCT identity) FROM events e WHERE e.day = d::date AND e.event_type = 'visit'), 0) AS visitors,
           COALESCE((SELECT COUNT(*) FROM events e WHERE e.day = d::date AND e.event_type = 'affiliate_click'), 0) AS clicks,
           COALESCE((SELECT COUNT(DISTINCT identity) FROM usage_daily u WHERE u.day = d::date), 0) AS active_users
         FROM generate_series($1::date, $2::date, '1 day') d
         ORDER BY day DESC`,
        [from, to]
      ),
      query(
        `SELECT l.id, l.brand, l.product, l.network, l.price, COUNT(*) AS clicks
         FROM events e JOIN listings l ON l.id = e.listing_id
         WHERE e.event_type = 'affiliate_click'
         GROUP BY l.id, l.brand, l.product, l.network, l.price
         ORDER BY clicks DESC LIMIT 15`
      ),
      query(
        `SELECT network, COUNT(*) AS clicks
         FROM events WHERE event_type = 'affiliate_click' AND network IS NOT NULL
         GROUP BY network ORDER BY clicks DESC`
      ),
      query(
        `SELECT identity, SUM(search_count) AS searches,
                COUNT(DISTINCT day) AS active_days,
                MAX(day) AS last_seen
         FROM usage_daily GROUP BY identity
         ORDER BY searches DESC LIMIT 25`
      ),
      query(
        `SELECT
           (SELECT COUNT(DISTINCT identity) FROM usage_daily WHERE day = (now() AT TIME ZONE 'utc')::date) AS dau,
           (SELECT COUNT(DISTINCT identity) FROM usage_daily WHERE day >= (now() AT TIME ZONE 'utc')::date - 6) AS wau,
           (SELECT COUNT(DISTINCT identity) FROM usage_daily WHERE day >= (now() AT TIME ZONE 'utc')::date - 29) AS mau`
      ),
      query(`SELECT plan, COUNT(*) AS users FROM user_plans GROUP BY plan`),
      query(
        `SELECT network, status, COUNT(*) AS listings
         FROM listings GROUP BY network, status ORDER BY listings DESC`
      ),
      getTrafficSources(days, { from, to }).then((rows) => ({ rows })),
      getCampaignPerformance(days, { from, to }).then((rows) => ({ rows })),
      getRevenueSummary(days, { from, to }).then((r) => ({ rows: [r] })),
      getInventoryByCountry().then((rows) => ({ rows })),
      getInventoryByCategory().then((rows) => ({ rows })),
      getRewardsReport().then((r) => ({ rows: [r] })),
      getClicksReport(days, { from, to }).then((r) => ({ rows: [r] })),
      getPwaStats(days, { from, to }).then((r) => ({ rows: [r] })),
    ]);

  return {
    range: { from, to },
    totals: totals.rows[0],
    daily: daily.rows,
    topProducts: topProducts.rows,
    byNetwork: byNetwork.rows,
    topUsers: topUsers.rows,
    activity: activity.rows[0],
    plans: plans.rows,
    inventory: inventory.rows,
    sources: sources.rows,
    campaigns: campaigns.rows,
    revenue: revenue.rows[0],
    inventoryByCountry: inventoryByCountry.rows,
    inventoryByCategory: inventoryByCategory.rows,
    rewards: rewardsReport.rows[0],
    clicksReport: clicksReport.rows[0],
    pwa: pwaStats.rows[0],
  };
}

// --- Direct advertiser programme -------------------------------------------

import { randomBytes } from "crypto";

export function newToken(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

export async function createAdvertiser(data) {
  const { rows } = await query(
    `INSERT INTO advertisers
       (company_name, website, contact_name, contact_email, phone, gst_number,
        billing_address, commission_model, commission_rate, currency, postback_secret)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, status`,
    [
      data.companyName, data.website, data.contactName || null, data.contactEmail,
      data.phone || null, data.gstNumber || null, data.billingAddress || null,
      data.commissionModel || "cps", data.commissionRate || 0,
      data.currency || "INR", newToken(24),
    ]
  );
  return rows[0];
}

export async function getAdvertisers(status) {
  const { rows } = status
    ? await query(`SELECT * FROM advertisers WHERE status = $1 ORDER BY created_at DESC`, [status])
    : await query(`SELECT * FROM advertisers ORDER BY created_at DESC`);
  return rows;
}

export async function getAdvertiserByEmail(email) {
  const { rows } = await query(`SELECT * FROM advertisers WHERE lower(contact_email) = lower($1)`, [email]);
  return rows[0] || null;
}

export async function setAdvertiserStatus(id, status) {
  await query(`UPDATE advertisers SET status = $1 WHERE id = $2`, [status, id]);
}

export async function addAdvertiserProduct(advertiserId, p) {
  const { rows } = await query(
    `INSERT INTO advertiser_products
       (advertiser_id, product_name, destination_url, price, category, image_url, description, tracking_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [advertiserId, p.productName, p.destinationUrl, p.price || null, p.category || null,
     p.imageUrl || null, p.description || null, newToken(8)]
  );
  return rows[0];
}

export async function getAdvertiserProducts(advertiserId) {
  const { rows } = await query(
    `SELECT * FROM advertiser_products WHERE advertiser_id = $1 ORDER BY created_at DESC`,
    [advertiserId]
  );
  return rows;
}

export async function getProductByTrackingId(trackingId) {
  const { rows } = await query(
    `SELECT p.*, a.status AS advertiser_status, a.id AS adv_id
     FROM advertiser_products p JOIN advertisers a ON a.id = p.advertiser_id
     WHERE p.tracking_id = $1`,
    [trackingId]
  );
  return rows[0] || null;
}

export async function recordAdvertiserClick({ clickId, advertiserId, productId, country }) {
  await query(
    `INSERT INTO advertiser_clicks (click_id, advertiser_id, product_id, country)
     VALUES ($1,$2,$3,$4) ON CONFLICT (click_id) DO NOTHING`,
    [clickId, advertiserId, productId || null, country || null]
  );
}

export async function getClick(clickId) {
  const { rows } = await query(
    `SELECT c.*, a.commission_model, a.commission_rate, a.postback_secret, a.cookie_days
     FROM advertiser_clicks c JOIN advertisers a ON a.id = c.advertiser_id
     WHERE c.click_id = $1`,
    [clickId]
  );
  return rows[0] || null;
}

export async function recordConversion({ clickId, advertiserId, orderId, orderValue, currency, commission }) {
  const { rows } = await query(
    `INSERT INTO advertiser_conversions
       (click_id, advertiser_id, order_id, order_value, currency, commission)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (advertiser_id, order_id) DO NOTHING
     RETURNING id`,
    [clickId, advertiserId, orderId || null, orderValue || null, currency || "INR", commission || null]
  );
  return rows[0] || null;   // null means it was a duplicate order
}

// Per-advertiser performance, used by both the advertiser's own dashboard and
// the admin billing view.
export async function getAdvertiserStats(advertiserId) {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM advertiser_clicks WHERE advertiser_id = $1) AS clicks,
       (SELECT COUNT(*) FROM advertiser_conversions WHERE advertiser_id = $1) AS conversions,
       (SELECT COALESCE(SUM(order_value),0) FROM advertiser_conversions WHERE advertiser_id = $1 AND status <> 'rejected') AS sales_value,
       (SELECT COALESCE(SUM(commission),0) FROM advertiser_conversions WHERE advertiser_id = $1 AND status = 'pending') AS commission_due,
       (SELECT COALESCE(SUM(commission),0) FROM advertiser_conversions WHERE advertiser_id = $1 AND status = 'paid') AS commission_paid`,
    [advertiserId]
  );
  return rows[0];
}

export async function getAllAdvertiserBilling() {
  const { rows } = await query(
    `SELECT a.id, a.company_name, a.contact_email, a.commission_model, a.commission_rate, a.currency, a.status,
            (SELECT COUNT(*) FROM advertiser_clicks c WHERE c.advertiser_id = a.id) AS clicks,
            (SELECT COUNT(*) FROM advertiser_conversions v WHERE v.advertiser_id = a.id) AS conversions,
            (SELECT COALESCE(SUM(order_value),0) FROM advertiser_conversions v WHERE v.advertiser_id = a.id AND v.status <> 'rejected') AS sales_value,
            (SELECT COALESCE(SUM(commission),0) FROM advertiser_conversions v WHERE v.advertiser_id = a.id AND v.status = 'pending') AS commission_due
     FROM advertisers a ORDER BY commission_due DESC, a.created_at DESC`
  );
  return rows;
}

// --- Published answers (SEO) ------------------------------------------------

export async function getPublishedAnswer(slug) {
  const { rows } = await query(
    `SELECT m.*, l.brand, l.product, l.price, l.network, l.network_link AS "networkLink",
            l.image_url AS "imageUrl", l.merchant_domain AS "merchantDomain"
     FROM microsites m
     LEFT JOIN listings l ON l.id = m.listing_id AND l.status = 'approved'${GERMAN_ONLY_FILTER}
     WHERE m.slug = $1 AND m.status = 'published'`,
    [slug]
  );
  return rows[0] || null;
}

export async function listPublishedAnswers({ limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT slug, topic, headline, summary, published_at, country
     FROM microsites
     WHERE status = 'published' AND slug IS NOT NULL
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

export async function getAllPublishedSlugs() {
  const { rows } = await query(
    `SELECT slug, published_at FROM microsites
     WHERE status = 'published' AND slug IS NOT NULL
     ORDER BY published_at DESC LIMIT 5000`
  );
  return rows;
}

export async function incrementAnswerViews(slug) {
  await query(`UPDATE microsites SET views = views + 1 WHERE slug = $1`, [slug]);
}

// Admin: drafts awaiting review, newest first.
export async function getDraftAnswers(limit = 60) {
  const { rows } = await query(
    `SELECT id, slug, topic, headline, summary, body, who_for, who_skip,
            alternatives, status, created_at, country
     FROM microsites
     WHERE slug IS NOT NULL AND status IN ('draft','published','rejected')
     ORDER BY (status = 'draft') DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function setAnswerStatus(id, status) {
  if (!["draft", "published", "rejected"].includes(status)) throw new Error("Invalid status");
  await query(
    `UPDATE microsites
     SET status = $1, published_at = CASE WHEN $1 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
     WHERE id = $2`,
    [status, id]
  );
}

export async function bulkPublishDrafts() {
  const { rowCount } = await query(
    `UPDATE microsites SET status = 'published', published_at = COALESCE(published_at, now())
     WHERE status = 'draft' AND slug IS NOT NULL`
  );
  return rowCount;
}

// Slugs must be unique. When the base slug is already taken, the topic has
// been answered before — return null so no page is created, rather than
// minting "-2"/"-3" near-duplicates that compete with the original page in
// search results (doorway-page risk). One canonical page per topic.
export async function reserveSlug(base) {
  if (!base) return null;
  const { rows } = await query(`SELECT 1 FROM microsites WHERE slug = $1 LIMIT 1`, [base]);
  return rows.length === 0 ? base : null;
}
