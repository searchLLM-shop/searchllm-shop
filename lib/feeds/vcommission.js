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

// --- Deeplinking: send shoppers to a SPECIFIC product page ---------------
//
// vCommission/Trackier campaigns are store-level offers — the API carries no
// product catalog (verified against a full 57-campaign dump: the response has
// no product/sku/price fields at all). But the tracking link accepts a `url`
// parameter that forwards to any page on the merchant's site while still
// crediting the sale, e.g.
//   https://track.vcommission.com/click?campaign_id=11008&pub_id=130649&url=<product page>
//
// So the shopper clicks once, passes through the tracker invisibly, and lands
// on the exact product — not a generic homepage. The tracking hop cannot be
// removed: it is what records the sale and pays the commission. Removing it
// would mean earning nothing, and the site's disclosure stays either way.
export function buildDeeplink(trackingLink, productUrl) {
  if (!trackingLink) return null;
  if (!productUrl) return trackingLink;
  try {
    const dest = new URL(productUrl);            // validate the destination
    const link = new URL(trackingLink);
    link.searchParams.set("url", dest.toString());
    return link.toString();
  } catch {
    return trackingLink;                          // bad URL — fall back safely
  }
}

// The merchant's own domain, used to check a product URL actually belongs to
// this advertiser before deeplinking to it.
export function merchantDomain(previewUrl) {
  try { return new URL(previewUrl).hostname.replace(/^www\./, ""); }
  catch { return null; }
}


const BASE_URL = process.env.VCOMMISSION_API_BASE || "https://api.trackier.com";

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, " ")        // remove tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")            // collapse whitespace
    .trim();
}

// Campaign titles are internal affiliate labels like
// "Shopsy.in Mobile Ecommerce CPS - India" — not something to show a
// shopper. Derive a clean brand from preview_url's domain when available,
// otherwise strip the boilerplate suffixes from the title.
function cleanBrand(raw) {
  const url = raw.preview_url;
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      if (base) return base.charAt(0).toUpperCase() + base.slice(1);
    } catch { /* fall through to title cleanup */ }
  }
  return String(raw.title || "")
    .replace(/\b(CPS|CPI|CPL|CPA|CPC)\b/gi, "")
    .replace(/\bEcommerce\b/gi, "")
    .replace(/\bMobile\b/gi, "")
    .replace(/[-–]\s*India\b/gi, "")
    .replace(/\.(com|in|co|io)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*-\s*$/, "")
    .trim() || raw.title;
}

function parseCampaign(raw) {
  const id = raw.id;
  const title = raw.title;
  const link = raw.tracking_link;
  if (!id || !title || !link) return null;

  const brand = cleanBrand(raw);

  // Payout: campaigns carry a payouts[] array; take the first/base payout.
  // model tells us how to read it (cps => percentage, others => flat amount
  // in the campaign currency). We show a readable payout note, not a price,
  // because these are offers, not fixed-price products.
  const currency = raw.currency || "USD";
  const symbol = currency === "INR" ? "₹" : currency === "EUR" ? "€" : "$";
  // Our commission rate is recorded for internal reporting, NOT shown to
  // shoppers. It used to be written into the `price` field, which meant a
  // shopper saw "8.4% commission" where the product price belongs — confusing
  // (it reads like a discount), commercially sensitive, and not what honest
  // disclosure requires. What matters to the shopper is that the link is
  // paid, doesn't change their price, and didn't determine the
  // recommendation — all of which the sponsored card already states.
  const payoutVal = Array.isArray(raw.payouts) && raw.payouts.length
    ? (raw.payouts[0].payout ?? raw.payouts[0].fixedPayout)
    : null;
  const commissionNote = payoutVal != null
    ? (String(raw.model).toLowerCase() === "cps"
        ? `${Math.round(Number(payoutVal) * 100) / 100}% CPS`
        : `${symbol}${Math.round(Number(payoutVal) * 100) / 100} CPA`)
    : null;

  // Campaign-level offers carry no product price — there is no single price
  // for a whole store. Leave it empty rather than inventing one.
  const price = null;

  // categories may be an array of strings; use the first to map into our
  // taxonomy, falling back to the title.
  const rawCat = Array.isArray(raw.categories) && raw.categories.length
    ? String(raw.categories[0])
    : "";
  const category = mapCategory(rawCat || title);

  // description is a large HTML blob in real responses — strip to plain text.
  const cleanDesc = stripHtml(raw.description || raw.kpi || "");

  return {
    externalId: String(id),
    brand,                            // clean brand, e.g. "Shopsy" not the raw campaign label
    product: brand,
    price,
    category,
    keywords: deriveKeywords(`${brand} ${title} ${rawCat}`, category),
    networkLink: link,
    // Merchant's own site — lets us later deeplink to a specific product page
    // on this domain via buildDeeplink(), instead of dropping the shopper on
    // a generic store homepage.
    merchantUrl: raw.preview_url || null,
    commissionNote,   // internal reporting only, never rendered to shoppers
    // Campaigns carry an explicit country list (e.g. ["IN"]). Used to avoid
    // showing an India-only offer to a shopper elsewhere.
    regions: Array.isArray(raw.countries) && raw.countries.length
      ? raw.countries.map((c) => String(c).toUpperCase())
      : null,
    pitch: cleanDesc.slice(0, 240) || null,
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
