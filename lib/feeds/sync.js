// lib/feeds/sync.js
//
// Orchestrates a sync run: calls each network's adapter SEQUENTIALLY (not
// in parallel — running all three feeds in memory at once was killing the
// serverless function with an out-of-memory error), upserts each network's
// normalized results as 'pending', and logs the run. A failure in one
// network doesn't stop the others.
//
// SYNC_LIMIT_PER_NETWORK is deliberately conservative so a single run
// stays well within the function's memory ceiling. Large catalogs are
// imported across several runs — dedup by (network, external_id) means
// re-running is safe and just fills in more each time. The 6-hourly cron
// also chips away at it automatically.

import { fetchAwinFeed } from "./awin";
import { fetchImpactFeed } from "./impact";
import { fetchVcommissionFeed } from "./vcommission";
import { fetchVcommissionProductFeed } from "./vcommissionProducts";
import { upsertFeedListing, bulkUpsertFeedListings, logSyncRun, getExistingExternalIds, getFeedCursor, setFeedCursor } from "@/lib/db";

const SYNC_LIMIT_PER_NETWORK = 150;

// Shared upsert+log for adapters that return a plain array of listings.
async function syncNetwork(network, fetchFn) {
  let productsSeen = 0;
  let newListings = 0;
  let updatedListings = 0;
  try {
    const listings = await fetchFn();
    productsSeen = listings.length;
    for (const listing of listings) {
      if (!listing.externalId || !listing.networkLink) continue;
      const { isNew } = await upsertFeedListing(network, listing);
      if (isNew) newListings += 1;
      else updatedListings += 1;
    }
    await logSyncRun({ network, status: "success", productsSeen, newListings, updatedListings });
    return { network, status: "success", productsSeen, newListings, updatedListings };
  } catch (err) {
    console.error(`Feed sync failed for ${network}:`, err);
    await logSyncRun({ network, status: "error", productsSeen, newListings, updatedListings, errorMessage: err.message });
    return { network, status: "error", error: err.message };
  }
}

export async function runFullSync() {
  const results = [];

  const productFeedUrls = (process.env.VCOMMISSION_PRODUCT_FEED_URLS || "")
    .split(",").map((u) => u.trim()).filter(Boolean);

  if (productFeedUrls.length) {
    try {
      const skipIds = await getExistingExternalIds("vCommission");
      // Two cursors: which feed we're on, and how far into that file we've read.
      const feedIdx = (await getFeedCursor("vcommission_feed_index")) % productFeedUrls.length;
      const byteOffset = await getFeedCursor(`vcommission_offset_${feedIdx}`);

      const { listings, nextOffset, done, rangeSupported } = await fetchVcommissionProductFeed(
        productFeedUrls[feedIdx],
        {
          limit: SYNC_LIMIT_PER_NETWORK,
          skipIds,
          minPrice: Number(process.env.MIN_PRODUCT_PRICE || 0),
        offset: byteOffset,
        }
      );

      let inserted = 0, updated = 0;
      const valid = listings.filter((l) => l.externalId && l.networkLink);
      if (valid.length) {
        const res = await bulkUpsertFeedListings("vCommission", valid);
        inserted = res.inserted;
        updated = res.updated;
      }

      // Advance within the file; when it's exhausted, move to the next feed.
      await setFeedCursor(`vcommission_offset_${feedIdx}`, nextOffset);
      if (done) {
        await setFeedCursor("vcommission_feed_index", (feedIdx + 1) % productFeedUrls.length);
      }

      // Logged under a DISTINCT network name. Both this and the campaigns sync
      // previously logged as "vCommission", and the status panel shows only
      // the most recent run per network — so the campaigns result (which runs
      // afterwards) silently hid this one, making a working product import
      // look like it never ran.
      await logSyncRun({ network: "vCommission Products", status: "success", productsSeen: listings.length, newListings: inserted, updatedListings: updated });
      results.push({
        network: "vCommission Products",
        status: "success",
        productsSeen: listings.length,
        newListings: inserted,
        updatedListings: updated,
        feed: `file ${feedIdx + 1}/${productFeedUrls.length}${rangeSupported === false ? " (no range support)" : done ? " (complete)" : ` @ ${(nextOffset / 1048576).toFixed(1)}MB`}`,
      });
    } catch (err) {
      console.error("vCommission product feed failed:", err);
      try {
        await logSyncRun({ network: "vCommission Products", status: "error", errorMessage: String(err?.message || err) });
      } catch { /* logging the failure must not mask it */ }
      results.push({ network: "vCommission Products", status: "error", error: String(err?.message || err) });
    }
  }

  // --- Awin: download ONE feed per run, advancing a persistent cursor ---
  if (process.env.AWIN_DATAFEED_API_KEY) {
    let stage = "start";
    try {
      stage = "getExistingExternalIds";
      const skipIds = await getExistingExternalIds("Awin");

      stage = "getFeedCursor";
      const cursor = await getFeedCursor("awin_feed_cursor");

      stage = "fetchAwinFeed";
      const { listings, feedCount, downloadedIndex } = await fetchAwinFeed(
        process.env.AWIN_DATAFEED_API_KEY,
        { limit: SYNC_LIMIT_PER_NETWORK, skipIds, cursor }
      );

      stage = `bulkUpsert(${listings.length})`;
      let newListings = 0;
      let updatedListings = 0;
      const valid = listings.filter((l) => l.externalId && l.networkLink);
      if (valid.length) {
        const res = await bulkUpsertFeedListings("Awin", valid);
        newListings = res.inserted;
        updatedListings = res.updated;
      }

      stage = "setFeedCursor";
      if (feedCount > 0) {
        await setFeedCursor("awin_feed_cursor", (downloadedIndex + 1) % feedCount);
      }

      stage = "logSyncRun";
      await logSyncRun({ network: "Awin", status: "success", productsSeen: listings.length, newListings, updatedListings });
      results.push({ network: "Awin", status: "success", productsSeen: listings.length, newListings, updatedListings, feed: `${downloadedIndex + 1}/${feedCount}` });
    } catch (err) {
      // Include the stage AND memory usage in the error so we can see
      // exactly where and why it failed instead of guessing.
      const mem = typeof process !== "undefined" && process.memoryUsage
        ? Math.round(process.memoryUsage().rss / 1048576) + "MB"
        : "?";
      const detail = `Awin failed at stage [${stage}] (rss ${mem}): ${err.message}`;
      console.error(detail, err);
      try { await logSyncRun({ network: "Awin", status: "error", errorMessage: detail }); } catch {}
      results.push({ network: "Awin", status: "error", error: detail });
    }
  }

  if (process.env.IMPACT_ACCOUNT_SID && process.env.IMPACT_AUTH_TOKEN) {
    results.push(await syncNetwork("Impact", () => fetchImpactFeed(process.env.IMPACT_ACCOUNT_SID, process.env.IMPACT_AUTH_TOKEN, { limit: SYNC_LIMIT_PER_NETWORK })));
  }

  // vCommission PRODUCT feeds (e.g. Shopsy) are hosted CSV files, not part of
  // the Publisher API. Set VCOMMISSION_PRODUCT_FEED_URLS to a comma-separated
  // list of feed URLs; each sync run pulls one, advancing by cursor so a large
  // catalogue imports across runs instead of blowing memory in one go.
  if (process.env.VCOMMISSION_API_KEY) {
    results.push(await syncNetwork("vCommission", () => fetchVcommissionFeed(process.env.VCOMMISSION_API_KEY, { limit: SYNC_LIMIT_PER_NETWORK })));
  }

  return results;
}
