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
    `SELECT id, brand, product, price, category, keywords, network, network_link AS "networkLink", pitch
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
    `INSERT INTO microsites (title, summary, task_type, learnings, listing_id, query_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      microsite.title,
      microsite.summary,
      microsite.taskType,
      JSON.stringify(microsite.learnings || []),
      microsite.listingId || null,
      microsite.queryHash || null,
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
    `INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status, source, external_id, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'feed', $9, now())
     ON CONFLICT (network, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET
       brand = $1, product = $2, price = $3, category = $4,
       keywords = $5, network_link = $7, pitch = $8, last_synced_at = now()
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
    ]
  );
  return { id: rows[0].id, isNew: rows[0].inserted };
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
