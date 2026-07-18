// lib/feeds/vcommission.js
//
// vCommission runs on the Trackier tracking platform, so this adapter
// talks to the Trackier Publisher API. Validated against the real OpenAPI
// spec (openapi-1_0_0.yaml), not guessed.
//
// Endpoint:  GET https://api.trackier.com/v2/publisher/campaigns
// Auth:      apiKey passed as a query parameter
// Approved:  showApproved=1 returns only offers you're approved for
// Response:  { success, data: { campaigns: [...], page, count } }
//
// Each "campaign" is an offer/advertiser deal (affiliate-network style),
// not an individual product — so each becomes one listing. The
// tracking_link field is the real deeplink that credits your publisher ID.

import { mapCategory, deriveKeywords } from "./normalizedListing";

const BASE_URL = process.env.VCOMMISSION_API_BASE || "https://api.trackier.com";

function parseCampaign(raw) {
  const id = raw.id;
  const title = raw.title;
  const link = raw.tracking_link;
  if (!id || !title || !link) return null;

  // Payout: campaigns carry a payouts[] array; take the first/base payout.
  // model tells us how to read it (cps => percentage, others => flat amount
  // in the campaign currency). We show a readable payout note, not a price,
  // because these are offers, not fixed-price products.
  const currency = raw.currency || "USD";
  const symbol = currency === "INR" ? "₹" : currency === "EUR" ? "€" : "$";
  const payoutVal = Array.isArray(raw.payouts) && raw.payouts.length
    ? (raw.payouts[0].payout ?? raw.payouts[0].fixedPayout)
    : null;
  let price = null;
  if (payoutVal != null) {
    price = String(raw.model).toLowerCase() === "cps"
      ? `${payoutVal}% commission`
      : `${symbol}${payoutVal}`;
  }

  // categories is an array of strings; use the first to map into our
  // taxonomy, falling back to the title.
  const rawCat = Array.isArray(raw.categories) && raw.categories.length ? raw.categories[0] : "";
  const category = mapCategory(rawCat || title);

  return {
    externalId: String(id),
    brand: title,                     // offer title is the advertiser/brand
    product: title,
    price,
    category,
    keywords: deriveKeywords(`${title} ${rawCat}`, category),
    networkLink: link,
    pitch: (raw.description || raw.kpi || "").slice(0, 240) || null,
  };
}

export async function fetchVcommissionFeed(apiKey, { limit = 500 } = {}) {
  if (!apiKey) {
    console.warn("VCOMMISSION_API_KEY not set — skipping vCommission sync");
    return [];
  }

  const listings = [];
  let page = 1;
  const pageSize = Math.min(limit, 1000); // Trackier default/limit is 1000
  const MAX_PAGES = Math.ceil(limit / pageSize) + 1;

  while (listings.length < limit && page <= MAX_PAGES) {
    try {
      const url = new URL(`${BASE_URL}/v2/publisher/campaigns`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("showApproved", "1"); // only offers we're approved for
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("page", String(page));

      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) {
        console.error(`Trackier/vCommission API error: ${resp.status}`, await resp.text());
        break;
      }

      const data = await resp.json();
      const campaigns = data?.data?.campaigns;
      if (!Array.isArray(campaigns) || campaigns.length === 0) break;

      for (const raw of campaigns) {
        if (listings.length >= limit) break;
        const normalized = parseCampaign(raw);
        if (normalized) listings.push(normalized);
      }

      if (campaigns.length < pageSize) break; // last page
      page += 1;
    } catch (err) {
      console.error("vCommission/Trackier feed fetch failed:", err.message);
      break;
    }
  }

  console.log(`vCommission: fetched ${listings.length} approved campaigns`);
  return listings;
}
