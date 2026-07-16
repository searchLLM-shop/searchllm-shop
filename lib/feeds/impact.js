// lib/feeds/impact.js
//
// Impact has a real REST API for this: list the catalogs you have access
// to, then search items within a catalog. This is more capable than
// Awin's bulk-file model — it supports live querying, not just full-file
// download — but for a sync job, pulling the catalog's items in pages is
// the simpler, more reliable approach (live per-query search is a future
// optimization once real listing volume justifies it).
//
// Docs: https://integrations.impact.com/impact-publisher/reference/list-catalogs
//       https://integrations.impact.com/impact-publisher/reference/search-catalog-items

import { mapCategory, deriveKeywords } from "./normalizedListing";

const BASE = "https://api.impact.com";

function authHeader(accountSid, authToken) {
  const encoded = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, Accept: "application/json" };
}

function parseImpactItem(raw) {
  if (!raw.Id || !raw.Name) return null;
  const category = mapCategory(raw.Category || raw.Name);

  return {
    externalId: String(raw.Id),
    brand: raw.AdvertiserName || raw.Manufacturer || "Unknown brand",
    product: raw.Name,
    price: raw.CurrentPrice ? `${raw.Currency || "$"}${raw.CurrentPrice}` : null,
    category,
    keywords: deriveKeywords(raw.Name, category),
    networkLink: raw.TrackingLink || raw.Url || null,
    pitch: (raw.Description || "").slice(0, 240) || null,
  };
}

export async function fetchImpactFeed(accountSid, authToken, { limit = 500 } = {}) {
  if (!accountSid || !authToken) {
    console.warn("IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN not set — skipping Impact sync");
    return [];
  }

  const headers = authHeader(accountSid, authToken);

  // Step 1: list catalogs available to this publisher account.
  const catalogsResp = await fetch(`${BASE}/Mediapartners/${accountSid}/Catalogs`, { headers });
  if (!catalogsResp.ok) {
    throw new Error(`Impact catalog list request failed: ${catalogsResp.status}`);
  }
  const catalogsData = await catalogsResp.json();
  const catalogs = catalogsData.Catalogs || catalogsData || [];

  const listings = [];
  for (const catalog of Array.isArray(catalogs) ? catalogs : []) {
    if (listings.length >= limit) break;
    if (!catalog.ItemsUri) continue;

    try {
      // Page through items for this catalog, stopping once the overall
      // limit is reached. Impact paginates with @pagesize / @page params.
      let page = 1;
      const pageSize = 100;
      while (listings.length < limit) {
        const itemsResp = await fetch(
          `${BASE}${catalog.ItemsUri}?@pagesize=${pageSize}&@page=${page}`,
          { headers }
        );
        if (!itemsResp.ok) break;
        const itemsData = await itemsResp.json();
        const items = itemsData.Items || itemsData || [];
        if (!items.length) break;

        for (const raw of items) {
          if (listings.length >= limit) break;
          const normalized = parseImpactItem(raw);
          if (normalized && normalized.networkLink) listings.push(normalized);
        }

        if (items.length < pageSize) break; // last page
        page += 1;
      }
    } catch (err) {
      console.error(`Impact: failed to fetch items for catalog ${catalog.Id}:`, err.message);
    }
  }

  return listings;
}
