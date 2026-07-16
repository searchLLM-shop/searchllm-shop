// lib/feeds/vcommission.js
//
// vCommission product/offer feed using their publisher API.
// Credentials: VCOMMISSION_API_KEY (dashboard: Tools -> API at
// partners.vcommission.com) and VCOMMISSION_NETWORK_ID.
//
// vCommission does not publish a full public API spec — this
// implementation follows their standard api_key + network_id pattern and
// parses defensively (multiple possible field names, multiple response
// wrappers). If your account manager gave you a different base URL or
// endpoint path, change BASE_URL / the endpoint below; everything else
// (dedup, pending status, human review) is shared pipeline and unchanged.

import { mapCategory, deriveKeywords } from "./normalizedListing";

const BASE_URL = process.env.VCOMMISSION_API_BASE || "https://api.vcommission.com/v1";

function parseVcommissionOffer(raw) {
  const id = raw.offer_id || raw.id || raw.campaign_id;
  const title = raw.offer_name || raw.name || raw.title || raw.product_title;
  const link =
    raw.tracking_url || raw.affiliate_url || raw.click_url || raw.deeplink || raw.tracking_link;
  if (!id || !title || !link) return null;

  const priceVal = raw.price || raw.payout || raw.commission_amount;
  const category = mapCategory(raw.category || raw.vertical || raw.offer_category || title);

  return {
    externalId: String(id),
    brand: raw.advertiser_name || raw.brand || raw.merchant_name || "Unknown brand",
    product: title,
    price: priceVal ? `₹${priceVal}` : null,
    category,
    keywords: deriveKeywords(title, category),
    networkLink: link,
    pitch: (raw.description || raw.offer_description || "").slice(0, 240) || null,
  };
}

export async function fetchVcommissionFeed(apiKey, { limit = 500 } = {}) {
  const networkId = process.env.VCOMMISSION_NETWORK_ID;
  if (!apiKey) {
    console.warn("VCOMMISSION_API_KEY not set — skipping vCommission sync");
    return [];
  }
  if (!networkId) {
    console.warn("VCOMMISSION_NETWORK_ID not set — skipping vCommission sync");
    return [];
  }

  const listings = [];
  let page = 1;
  const pageSize = 100;
  // Hard cap on pages — without this, an API that ignores pagination params
  // or returns a non-empty response every time would loop until the
  // function runs out of memory. limit/pageSize + 1 is all we ever need.
  const MAX_PAGES = Math.ceil(limit / pageSize) + 1;

  while (listings.length < limit && page <= MAX_PAGES) {
    try {
      const url = new URL(`${BASE_URL}/offers`);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("network_id", networkId);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("status", "active");

      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) {
        console.error(`vCommission API error: ${resp.status}`, await resp.text());
        break;
      }
      const data = await resp.json();
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.offers) ? data.offers
        : Array.isArray(data.data) ? data.data
        : [];
      if (!items.length) break;

      for (const raw of items) {
        if (listings.length >= limit) break;
        const normalized = parseVcommissionOffer(raw);
        if (normalized) listings.push(normalized);
      }
      if (items.length < pageSize) break;
      page += 1;
    } catch (err) {
      console.error("vCommission feed fetch failed:", err.message);
      break;
    }
  }
  return listings;
}
