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

// Products taken per chunk. A 3MB slice holds roughly 2,800 rows, so this
// keeps most of what we parse instead of discarding it.
const PRODUCTS_PER_CHUNK = Number(process.env.PRODUCTS_PER_CHUNK || 1200);

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
    // Pull repeatedly within a time budget rather than a single 150-product
    // chunk. One chunk per run meant a large catalogue would take months to
    // import, and made bulk approval pointless — you'd approve 150, sync, and
    // approve 150 again.
    const PRODUCT_TIME_BUDGET_MS = Number(process.env.SYNC_TIME_BUDGET_MS || 180000);
    const startedAt = Date.now();
    let totalSeen = 0, totalNew = 0, totalUpdated = 0, chunks = 0, lastFeed = 0, lastOffset = 0;
    let failure = null;

    try {
      const skipIds = await getExistingExternalIds("vCommission");

      while (Date.now() - startedAt < PRODUCT_TIME_BUDGET_MS) {
        const feedIdx = (await getFeedCursor("vcommission_feed_index")) % productFeedUrls.length;
        const byteOffset = await getFeedCursor(`vcommission_offset_${feedIdx}`);

        const { listings, nextOffset, done } = await fetchVcommissionProductFeed(
          productFeedUrls[feedIdx],
          {
            limit: PRODUCTS_PER_CHUNK,
            skipIds,
            minPrice: Number(process.env.MIN_PRODUCT_PRICE || 0),
            offset: byteOffset,
          }
        );

        const valid = listings.filter((l) => l.externalId && l.networkLink);
        if (valid.length) {
          const res = await bulkUpsertFeedListings("vCommission", valid);
          totalNew += res.inserted;
          totalUpdated += res.updated;
          // Remember what we just imported so later chunks in this same run
          // don't re-add them.
          for (const l of valid) skipIds.add(l.externalId);
        }
        totalSeen += listings.length;
        chunks += 1;
        lastFeed = feedIdx;
        lastOffset = nextOffset;

        await setFeedCursor(`vcommission_offset_${feedIdx}`, nextOffset);
        if (done) {
          await setFeedCursor("vcommission_feed_index", (feedIdx + 1) % productFeedUrls.length);
          // Every feed exhausted — nothing further to pull this run.
          if ((feedIdx + 1) % productFeedUrls.length === 0 && listings.length === 0) break;
        }
        if (listings.length === 0 && !done) break; // nothing new in this slice
      }
    } catch (err) {
      console.error("vCommission product feed failed:", err);
      failure = String(err?.message || err);
    }

    await logSyncRun({
      network: "vCommission Products",
      status: failure ? "error" : "success",
      productsSeen: totalSeen,
      newListings: totalNew,
      updatedListings: totalUpdated,
      errorMessage: failure,
    });
    results.push({
      network: "vCommission Products",
      status: failure ? "error" : "success",
      productsSeen: totalSeen,
      newListings: totalNew,
      updatedListings: totalUpdated,
      error: failure || undefined,
      feed: `${chunks} chunks · file ${lastFeed + 1}/${productFeedUrls.length} @ ${(lastOffset / 1048576).toFixed(1)}MB`,
    });
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
