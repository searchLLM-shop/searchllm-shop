// lib/priceAlerts.js
//
// Price-drop watchlist: a shopper "watches" a partner listing, and gets
// notified when its price falls. Deliberately built on top of data the app
// already keeps fresh rather than adding a new fetch job — see the comment
// in migrations/2026-08-06_price_alerts.sql for why.

import { query } from "@/lib/db";
import { sendText } from "@/lib/whatsapp";
import { probeLivePrice, isProbeSupported, formatInr } from "@/lib/priceProbe";

// --- Live price checks (see lib/priceProbe.js) --------------------------------
//
// The affiliate feeds do not keep prices fresh, so the price a watch is
// compared against comes from the merchant's own product page, read at most
// once per RECHECK_HOURS per listing. Hosts the probe doesn't support are
// simply left on their feed price (and say so — see priceCheckStatus).
const RECHECK_HOURS = 6;
const PICK_RECHECK_HOURS = 12;   // for listings merely shown as a pick
const MAX_PROBES_PER_RUN = 40;   // keeps the cron inside its 60s budget
const PROBE_GAP_MS = 250;        // politeness gap between merchant requests

let checkColumnsMissing = false; // set if the price_checked_at migration hasn't run

// Probes one listing and, if it succeeded, writes the live price back to
// listings.price (so search results and watchlists agree), stamps the check,
// and appends a price_history point when the price moved (or the last point
// is over a day old, so a flat history still shows it was being watched).
// `listing` needs { id, network_link, price }. Never throws.
export async function recordLivePrice(listing) {
  if (!listing?.network_link || !isProbeSupported(listing.network_link)) {
    return { status: "unsupported" };
  }
  const result = await probeLivePrice(listing.network_link);
  const feedPrice = parsePriceValue(listing.price);

  const stamp = async (status, newPriceText) => {
    try {
      if (checkColumnsMissing) {
        if (newPriceText) await query(`UPDATE listings SET price = $1 WHERE id = $2`, [newPriceText, listing.id]);
        return;
      }
      await query(
        `UPDATE listings SET price = COALESCE($1, price), price_checked_at = now(), price_check_status = $2 WHERE id = $3`,
        [newPriceText, status, listing.id]
      );
    } catch (err) {
      if (err.code === "42703") {
        checkColumnsMissing = true;
        console.error("listings.price_checked_at is missing — run the price-check migration (schema.sql). Falling back to price-only updates.");
        if (newPriceText) await query(`UPDATE listings SET price = $1 WHERE id = $2`, [newPriceText, listing.id]).catch(() => {});
      } else {
        console.error("Live price write failed:", err.message);
      }
    }
  };

  if (!result.ok) {
    await stamp(result.status, null);
    return { status: result.status, detail: result.detail };
  }
  // INR listings only: a different currency on the page means we're looking
  // at something else, so don't overwrite.
  if (result.currency && result.currency !== "INR" && /₹/.test(String(listing.price || ""))) {
    await stamp("currency_mismatch", null);
    return { status: "currency_mismatch" };
  }
  // Guard against a parse glitch rewriting a price absurdly.
  if (feedPrice && (result.price < feedPrice * 0.1 || result.price > feedPrice * 10)) {
    await stamp("suspect", null);
    return { status: "suspect", detail: `${result.price} vs ${feedPrice}` };
  }

  const changed = feedPrice == null || Math.abs(result.price - feedPrice) >= 1;
  await stamp(result.inStock === false ? "out_of_stock" : "ok", changed ? formatInr(result.price) : null);

  try {
    const { rows: last } = await query(
      `SELECT price, checked_at FROM price_history WHERE listing_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [listing.id]
    );
    const lastPrice = last[0]?.price != null ? Number(last[0].price) : null;
    const lastAt = last[0]?.checked_at ? new Date(last[0].checked_at).getTime() : 0;
    const stale = Date.now() - lastAt > 20 * 3600 * 1000;
    if (lastPrice !== result.price || stale) {
      await query(`INSERT INTO price_history (listing_id, price) VALUES ($1, $2)`, [listing.id, result.price]);
    }
  } catch (err) {
    console.error("Price history write failed:", err.message);
  }
  return { status: result.inStock === false ? "out_of_stock" : "ok", price: result.price, previous: feedPrice, changed, inStock: result.inStock };
}

// For listings shown as a pick/extra: check the live price if it hasn't been
// checked recently. Safe to fire and forget. Never throws.
export async function refreshPickPrice(listingId, { maxAgeHours = PICK_RECHECK_HOURS } = {}) {
  try {
    const { rows } = await query(
      `SELECT id, network_link, price${checkColumnsMissing ? "" : ", price_checked_at"} FROM listings WHERE id = $1`,
      [listingId]
    );
    const l = rows[0];
    if (!l) return null;
    if (l.price_checked_at && Date.now() - new Date(l.price_checked_at).getTime() < maxAgeHours * 3600 * 1000) {
      return { status: "fresh" };
    }
    return await recordLivePrice(l);
  } catch (err) {
    if (err.code === "42703") checkColumnsMissing = true;
    else console.error("refreshPickPrice failed:", err.message);
    return null;
  }
}

// What a shopper is told about a listing's price history: the lowest and
// highest live prices we have seen and when it was last checked. Needs at
// least two points to say anything.
export async function getPriceHistorySummary(listingIds) {
  const ids = (listingIds || []).filter((n) => Number.isFinite(Number(n))).map(Number);
  if (!ids.length) return new Map();
  try {
    const { rows } = await query(
      `SELECT listing_id AS "listingId", MIN(price) AS lowest, MAX(price) AS highest,
              COUNT(*)::int AS points, MIN(checked_at) AS "firstAt", MAX(checked_at) AS "lastAt"
       FROM price_history WHERE listing_id = ANY($1::int[]) GROUP BY listing_id`,
      [ids]
    );
    const out = new Map();
    for (const r of rows) {
      out.set(r.listingId, {
        lowest: Number(r.lowest), highest: Number(r.highest), points: r.points,
        firstAt: r.firstAt, lastAt: r.lastAt,
      });
    }
    return out;
  } catch (err) {
    console.error("Price history summary failed:", err.message);
    return new Map();
  }
}

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
  // Start from the merchant's live price, not the feed's: a stale feed price
  // as the baseline would turn the first real check into a fake "drop".
  await refreshPickPrice(listingId, { maxAgeHours: 2 });
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
            l.network, l.merchant_domain AS "merchantDomain", l.network_link AS "networkLink"
     FROM price_watches w
     JOIN listings l ON l.id = w.listing_id
     WHERE w.identity = $1 AND w.active = true
     ORDER BY w.created_at DESC`,
    [identity]
  );
  const history = await getPriceHistorySummary(rows.map((r) => r.listingId));
  return rows.map(({ networkLink, ...r }) => {
    const currentPrice = parsePriceValue(r.currentPriceText);
    const baseline = r.baselinePrice != null ? Number(r.baselinePrice) : null;
    const dropped = baseline != null && currentPrice != null && currentPrice < baseline;
    const h = history.get(r.listingId);
    return {
      ...r,
      // Whether we can read this product's live price from the merchant's
      // own page (otherwise the price shown is the feed's, and may be stale).
      liveTracked: isProbeSupported(networkLink),
      lowestSeen: h && h.points >= 2 ? h.lowest : null,
      lastCheckedAt: h?.lastAt || null,
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
  const loadWatched = (withCheckCols) =>
    query(
      `SELECT DISTINCT l.id, l.price, l.product, l.brand, l.network_link${withCheckCols ? ", l.price_checked_at" : ""}
       FROM listings l
       JOIN price_watches w ON w.listing_id = l.id AND w.active = true`
    );
  let watchedListings;
  try {
    ({ rows: watchedListings } = await loadWatched(!checkColumnsMissing));
  } catch (err) {
    if (err.code !== "42703") throw err;
    checkColumnsMissing = true;
    console.error("listings.price_checked_at is missing — run the price-check migration (schema.sql).");
    ({ rows: watchedListings } = await loadWatched(false));
  }

  let checked = 0;
  let notified = 0;
  const probe = { attempted: 0, ok: 0, unsupported: 0, failed: 0, priceChanged: 0 };

  for (const listing of watchedListings) {
    // Refresh the price from the merchant's own page first (rate-limited per
    // listing and per run), so everything below compares live numbers.
    const dueForProbe =
      !listing.price_checked_at || Date.now() - new Date(listing.price_checked_at).getTime() > RECHECK_HOURS * 3600 * 1000;
    if (!isProbeSupported(listing.network_link)) {
      probe.unsupported++;
    } else if (dueForProbe && probe.attempted < MAX_PROBES_PER_RUN) {
      probe.attempted++;
      const r = await recordLivePrice(listing);
      if (r.status === "ok" || r.status === "out_of_stock") {
        probe.ok++;
        if (r.changed) {
          probe.priceChanged++;
          listing.price = formatInr(r.price);
        }
      } else {
        probe.failed++;
      }
      await new Promise((res) => setTimeout(res, PROBE_GAP_MS));
    }

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

  return { checked, notified, probe };
}
