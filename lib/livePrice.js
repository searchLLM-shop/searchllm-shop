// lib/livePrice.js
//
// Correct prices on picks. The affiliate feeds don't keep prices fresh (the
// vCommission feed is imported once; the hourly sync only adds new
// products), so when a listing is shown as a research pick we check the
// merchant's own product page (lib/priceProbe.js) and, if it differs, store
// the live price back on the listing so the shopper sees the right number.
//
// Deliberately scoped to picks: nothing here runs on a schedule, and nothing
// tracks or alerts on prices over time. A listing is only ever checked
// because a shopper's question just surfaced it, at most once per
// PICK_RECHECK_HOURS.

import { query } from "@/lib/db";
import { probeLivePrice, isProbeSupported, formatInr } from "@/lib/priceProbe";

const PICK_RECHECK_HOURS = 12;

let checkColumnsMissing = false; // set if the price_checked_at migration hasn't run

function parsePriceValue(text) {
  const n = parseFloat(String(text ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Probes one listing and, on success, writes the live price to
// listings.price and stamps the check. `listing` needs { id, network_link,
// price }. Never throws. Returns { status, price?, previous?, changed? }.
async function recordLivePrice(listing) {
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
  const status = result.inStock === false ? "out_of_stock" : "ok";
  await stamp(status, changed ? formatInr(result.price) : null);
  return { status, price: result.price, previous: feedPrice, changed, inStock: result.inStock };
}

// Checks the live price of a listing that was just shown as a pick (or an
// extra), unless it was checked recently. Safe to fire and forget. Never
// throws. Returns null on failure, { status: "fresh" } if recently checked.
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
    const t0 = Date.now();
    const out = await recordLivePrice(l);
    // One line per check so a blocked merchant, a timeout or a parse miss is
    // visible in the runtime logs (the probe's own failures are otherwise silent).
    console.log(`live price listing=${listingId} status=${out.status}${out.detail ? ` detail="${out.detail}"` : ""}${out.price ? ` price=${out.price} feed=${out.previous}` : ""} ms=${Date.now() - t0}`);
    return out;
  } catch (err) {
    if (err.code === "42703") {
      checkColumnsMissing = true;
      console.error("live price: listings.price_checked_at is missing — run the migration in schema.sql (check skipped this time).");
    } else {
      console.error("refreshPickPrice failed:", err.message);
    }
    return null;
  }
}
