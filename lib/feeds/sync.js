// lib/feeds/sync.js
//
// Orchestrates a full sync run: calls each network's adapter, upserts the
// normalized results into the listings table (always as 'pending' for new
// products — see lib/db.js upsertFeedListing), and logs the run for the
// admin UI to display. A failure in one network's adapter doesn't stop
// the others from running.

import { fetchAwinFeed } from "./awin";
import { fetchImpactFeed } from "./impact";
import { fetchVcommissionFeed } from "./vcommission";
import { upsertFeedListing, logSyncRun } from "@/lib/db";

const SYNC_LIMIT_PER_NETWORK = 500;

async function syncNetwork(network, fetchFn) {
  let productsSeen = 0;
  let newListings = 0;
  let updatedListings = 0;

  try {
    const listings = await fetchFn();
    productsSeen = listings.length;

    for (const listing of listings) {
      if (!listing.externalId || !listing.networkLink) continue; // can't dedup or link without these
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
  const results = await Promise.all([
    syncNetwork("Awin", () => fetchAwinFeed(process.env.AWIN_DATAFEED_API_KEY, { limit: SYNC_LIMIT_PER_NETWORK })),
    syncNetwork("Impact", () => fetchImpactFeed(process.env.IMPACT_ACCOUNT_SID, process.env.IMPACT_AUTH_TOKEN, { limit: SYNC_LIMIT_PER_NETWORK })),
    syncNetwork("vCommission", () => fetchVcommissionFeed(process.env.VCOMMISSION_API_KEY, { limit: SYNC_LIMIT_PER_NETWORK })),
  ]);
  return results;
}
