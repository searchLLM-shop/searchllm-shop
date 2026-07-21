// lib/db.js
//
// Minimal Postgres client. Works with Vercel Postgres, Supabase, Neon, or
// any standard Postgres connection string in DATABASE_URL.
//
// Run the schema below once against your database before first deploy
// (psql $DATABASE_URL -f schema.sql, or paste into your provider's SQL console).

import { Pool } from "pg";

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

export async function getPendingListings() {
  const { rows } = await query(
    `SELECT id, brand, product, price, category, keywords, network, network_link AS "networkLink", pitch, source, created_at AS "createdAt"
     FROM listings WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return rows;
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
// that are already pending — never re-opens an approved listing.
export async function bulkSetPendingStatus(status, network) {
  if (!["approved", "rejected"].includes(status)) {
    throw new Error("Invalid bulk status");
  }
  const result = network
    ? await query(`UPDATE listings SET status = $1 WHERE status = 'pending' AND network = $2`, [status, network])
    : await query(`UPDATE listings SET status = $1 WHERE status = 'pending'`, [status]);
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
       keywords = $5, network_link = $7, pitch = $8, last_synced_at = now(),
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
       category = EXCLUDED.category, keywords = EXCLUDED.keywords,
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
export async function getListingsNeedingKeywords(limit = 100) {
  const { rows } = await query(
    `SELECT id, brand, product, category, pitch, keywords
     FROM listings
     WHERE status IN ('pending', 'approved')
     ORDER BY (keywords IS NULL) DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function updateListingKeywords(id, keywords) {
  await query(`UPDATE listings SET keywords = $1 WHERE id = $2`, [keywords, id]);
}

// --- Scalable listing search -----------------------------------------------
// Previously every search loaded ALL approved listings into memory and scored
// them in JavaScript. That's fine for a few hundred rows and untenable once a
// marketplace feed pushes the table into six figures. Postgres now does the
// narrowing with an indexed array-overlap, returning a small candidate set
// that JS scores precisely (stopwords, word boundaries, phrase weighting).
export async function findCandidateListings(terms, userCountry, limit = 40) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  const { rows } = await query(
    `SELECT id, brand, product, price, category, keywords, network,
            network_link AS "networkLink", pitch, regions,
            image_url AS "imageUrl", merchant_domain AS "merchantDomain", discount,
            rating, rating_count AS "ratingCount"
     FROM listings
     WHERE status = 'approved'
       AND keywords && $1::text[]
       AND ($2::text IS NULL OR regions IS NULL OR $2 = ANY(regions))
     LIMIT $3`,
    [terms, userCountry, limit]
  );
  return rows;
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
export async function getTrafficSources(days = 30) {
  const { rows } = await query(
    `SELECT
       COALESCE(utm_source, referrer_host, 'direct') AS source,
       utm_medium AS medium,
       utm_campaign AS campaign,
       COUNT(DISTINCT identity) AS visitors,
       COUNT(*) AS visits
     FROM events
     WHERE event_type = 'visit' AND day >= (now() AT TIME ZONE 'utc')::date - ($1::int - 1)
     GROUP BY 1, 2, 3
     ORDER BY visitors DESC
     LIMIT 40`,
    [days]
  );
  return rows;
}

// Campaign performance end to end: visitors, searches they ran, and clicks
// on partner products. This is what tells you whether an ad campaign paid
// for itself, which raw visitor counts never will.
export async function getCampaignPerformance(days = 30) {
  const { rows } = await query(
    `WITH first_touch AS (
       SELECT DISTINCT ON (identity) identity,
              COALESCE(utm_source, referrer_host, 'direct') AS source,
              utm_campaign AS campaign
       FROM events
       WHERE event_type = 'visit' AND day >= (now() AT TIME ZONE 'utc')::date - ($1::int - 1)
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
    [days]
  );
  return rows;
}

// Everything the reports panel needs, in one round trip per section.
export async function getReportSummary(days = 30) {
  const [totals, daily, topProducts, byNetwork, topUsers, activity, plans, inventory, sources, campaigns] =
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
         FROM generate_series((now() AT TIME ZONE 'utc')::date - ($1::int - 1), (now() AT TIME ZONE 'utc')::date, '1 day') d
         ORDER BY day DESC`,
        [days]
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
      getTrafficSources(days).then((rows) => ({ rows })),
      getCampaignPerformance(days).then((rows) => ({ rows })),
    ]);

  return {
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
     LEFT JOIN listings l ON l.id = m.listing_id AND l.status = 'approved'
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
    `SELECT id, slug, topic, headline, summary, body, status, created_at, country
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

// Slugs must be unique; append a short suffix when a topic repeats rather
// than overwriting an existing page.
export async function reserveSlug(base) {
  if (!base) return null;
  const { rows } = await query(`SELECT slug FROM microsites WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`]);
  if (rows.length === 0) return base;
  return `${base}-${rows.length + 1}`;
}
