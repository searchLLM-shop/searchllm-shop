// lib/priceAlerts.js
//
// Price-drop watchlist: a shopper "watches" a partner listing, and gets
// notified when its price falls. Deliberately built on top of data the app
// already keeps fresh rather than adding a new fetch job — see the comment
// in migrations/2026-08-06_price_alerts.sql for why.

import { query } from "@/lib/db";
import { sendText } from "@/lib/whatsapp";

// listings.price is free-text ("$189", "₹4,499", "₹80,000" — whatever the
// network feed sends). We only need it as a comparable number; currency
// symbols are stripped rather than parsed, which is safe here because we
// only ever compare a listing's price against its OWN earlier price, never
// across listings or currencies.
export function parsePriceValue(text) {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// A drop has to be real to be worth a notification — 3% or more, OR the
// shopper's own target price was just crossed. Without a floor, ordinary
// feed noise (a paisa-level rounding change on every sync) would notify
// constantly and the feature would get muted within a day.
const MIN_DROP_FRACTION = 0.03;

function isWorthNotifying({ previousPrice, currentPrice, targetPrice }) {
  if (previousPrice == null || currentPrice == null) return false;
  if (currentPrice >= previousPrice) return false;
  if (targetPrice != null) {
    // Only fire once the price actually crosses the shopper's own bar —
    // a 1% drop that's still above their target isn't news to them yet.
    return currentPrice <= targetPrice && previousPrice > targetPrice;
  }
  return (previousPrice - currentPrice) / previousPrice >= MIN_DROP_FRACTION;
}

// --- Shopper-facing: add / remove / list -----------------------------------

export async function addWatch({ identity, listingId, targetPrice }) {
  const { rows } = await query(
    `SELECT price FROM listings WHERE id = $1`,
    [listingId]
  );
  if (!rows.length) throw new Error("Listing not found");
  const baselinePriceText = rows[0].price;
  const baselinePrice = parsePriceValue(baselinePriceText);

  const result = await query(
    `INSERT INTO price_watches (identity, listing_id, baseline_price, baseline_price_text, target_price, last_checked_price)
     VALUES ($1, $2, $3, $4, $5, $3)
     ON CONFLICT (identity, listing_id)
     DO UPDATE SET active = true, target_price = EXCLUDED.target_price
     RETURNING id, baseline_price AS "baselinePrice", baseline_price_text AS "baselinePriceText", target_price AS "targetPrice"`,
    [identity, listingId, baselinePrice, baselinePriceText, targetPrice ?? null]
  );
  return result.rows[0];
}

export async function removeWatch({ identity, listingId }) {
  await query(
    `UPDATE price_watches SET active = false WHERE identity = $1 AND listing_id = $2`,
    [identity, listingId]
  );
}

// Everything a shopper needs to see their watchlist: current listing
// details, the price when they started watching, and how far (if at all)
// it's moved since.
export async function listWatchesForIdentity(identity) {
  const { rows } = await query(
    `SELECT w.id, w.listing_id AS "listingId", w.baseline_price AS "baselinePrice",
            w.baseline_price_text AS "baselinePriceText", w.target_price AS "targetPrice",
            w.last_checked_price AS "lastCheckedPrice", w.created_at AS "createdAt",
            l.brand, l.product, l.price AS "currentPriceText", l.image_url AS "imageUrl",
            l.network, l.merchant_domain AS "merchantDomain"
     FROM price_watches w
     JOIN listings l ON l.id = w.listing_id
     WHERE w.identity = $1 AND w.active = true
     ORDER BY w.created_at DESC`,
    [identity]
  );
  return rows.map((r) => {
    const currentPrice = parsePriceValue(r.currentPriceText);
    const baseline = r.baselinePrice != null ? Number(r.baselinePrice) : null;
    const dropped = baseline != null && currentPrice != null && currentPrice < baseline;
    return {
      ...r,
      currentPrice,
      dropped,
      dropAmount: dropped ? Number((baseline - currentPrice).toFixed(2)) : 0,
      dropPercent: dropped && baseline > 0 ? Math.round(((baseline - currentPrice) / baseline) * 100) : 0,
    };
  });
}

// Recent notifications for the bell/alerts panel, newest first.
export async function listAlertsForIdentity(identity, limit = 20) {
  const { rows } = await query(
    `SELECT a.id, a.old_price AS "oldPrice", a.new_price AS "newPrice", a.channel,
            a.created_at AS "createdAt", a.seen_at AS "seenAt",
            l.id AS "listingId", l.brand, l.product, l.image_url AS "imageUrl"
     FROM price_alerts a
     JOIN listings l ON l.id = a.listing_id
     WHERE a.identity = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [identity, limit]
  );
  return rows;
}

export async function countUnseenAlerts(identity) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM price_alerts WHERE identity = $1 AND seen_at IS NULL`,
    [identity]
  );
  return rows[0]?.n || 0;
}

export async function markAlertsSeen(identity) {
  await query(
    `UPDATE price_alerts SET seen_at = now() WHERE identity = $1 AND seen_at IS NULL`,
    [identity]
  );
}

// --- Cron: called shortly after the hourly feed sync -----------------------
//
// For every listing with at least one active watch, compare its current
// price against what each watcher last saw. A real drop (or crossing a
// shopper's own target) writes a price_alerts row and, for WhatsApp-channel
// shoppers, sends the message directly — everyone else sees it next time
// they open the app, which the header badge (countUnseenAlerts) surfaces.
export async function processPriceDrops() {
  const { rows: watchedListings } = await query(
    `SELECT DISTINCT l.id, l.price, l.product, l.brand
     FROM listings l
     JOIN price_watches w ON w.listing_id = l.id AND w.active = true`
  );

  let checked = 0;
  let notified = 0;

  for (const listing of watchedListings) {
    const currentPrice = parsePriceValue(listing.price);
    checked++;

    // Snapshot the price for this listing once per run (not once per
    // watcher) — keeps price_history at one row per listing per check,
    // not one row per watcher per check.
    if (currentPrice != null) {
      const { rows: last } = await query(
        `SELECT price FROM price_history WHERE listing_id = $1 ORDER BY checked_at DESC LIMIT 1`,
        [listing.id]
      );
      const lastPrice = last[0]?.price != null ? Number(last[0].price) : null;
      if (lastPrice !== currentPrice) {
        await query(`INSERT INTO price_history (listing_id, price) VALUES ($1, $2)`, [listing.id, currentPrice]);
      }
    }

    const { rows: watches } = await query(
      `SELECT id, identity, last_checked_price AS "lastCheckedPrice",
              last_notified_price AS "lastNotifiedPrice", target_price AS "targetPrice"
       FROM price_watches WHERE listing_id = $1 AND active = true`,
      [listing.id]
    );

    for (const w of watches) {
      const previousPrice = w.lastCheckedPrice != null ? Number(w.lastCheckedPrice) : null;
      const targetPrice = w.targetPrice != null ? Number(w.targetPrice) : null;

      if (isWorthNotifying({ previousPrice, currentPrice, targetPrice })) {
        // Never re-notify for the same price twice, even if the cron runs
        // again before the shopper has checked the app.
        const lastNotified = w.lastNotifiedPrice != null ? Number(w.lastNotifiedPrice) : null;
        if (lastNotified == null || currentPrice < lastNotified) {
          const channel = String(w.identity).startsWith("wa:") ? "whatsapp" : "inapp";
          await query(
            `INSERT INTO price_alerts (watch_id, identity, listing_id, old_price, new_price, channel)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [w.id, w.identity, listing.id, previousPrice, currentPrice, channel]
          );
          await query(
            `UPDATE price_watches SET last_notified_price = $1, last_notified_at = now() WHERE id = $2`,
            [currentPrice, w.id]
          );
          notified++;

          if (channel === "whatsapp") {
            const phone = String(w.identity).slice(3);
            const label = [listing.brand, listing.product].filter(Boolean).join(" ");
            sendText(
              phone,
              `Price drop on your watchlist: ${label} is now ${listing.price} (was ${previousPrice != null ? "₹" + previousPrice : "higher"}). See it: https://searchllm.shop/out/${listing.id}?ctx=watchlist`
            ).catch((e) => console.error("Price alert WhatsApp send failed:", e.message));
          }
        }
      }

      if (currentPrice != null && currentPrice !== previousPrice) {
        await query(`UPDATE price_watches SET last_checked_price = $1 WHERE id = $2`, [currentPrice, w.id]);
      }
    }
  }

  return { checked, notified };
}
