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
import { upsertFeedListing, logSyncRun } from "@/lib/db";

const SYNC_LIMIT_PER_NETWORK = 150;

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
  // Sequential, not Promise.all — one network's feed in memory at a time.
  const results = [];
  results.push(await syncNetwork("Awin", () => fetchAwinFeed(process.env.AWIN_DATAFEED_API_KEY, { limit: SYNC_LIMIT_PER_NETWORK })));
  results.push(await syncNetwork("Impact", () => fetchImpactFeed(process.env.IMPACT_ACCOUNT_SID, process.env.IMPACT_AUTH_TOKEN, { limit: SYNC_LIMIT_PER_NETWORK })));
  results.push(await syncNetwork("vCommission", () => fetchVcommissionFeed(process.env.VCOMMISSION_API_KEY, { limit: SYNC_LIMIT_PER_NETWORK })));
  return results;
}
