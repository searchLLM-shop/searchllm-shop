// lib/feeds/normalizedListing.js
//
// Every network's feed format is different (Awin uses the Google Shopping
// product spec, Impact uses its own "Impact Format", vCommission's format
// is unknown until their support team confirms it). Each adapter's job is
// to map its network's raw format into this one common shape — everything
// downstream (dedup, writing to the database, the admin queue, the AI
// matching logic) only ever deals with this shape and never needs to know
// which network it came from.

// @typedef {Object} NormalizedListing
// @property {string} externalId   - the network's own product/SKU ID, used for dedup on re-sync
// @property {string} brand        - advertiser/merchant name
// @property {string} product      - product title
// @property {string} price        - display price, e.g. "$129" or "₹4,499"
// @property {string} category     - mapped to one of the app's fixed categories
// @property {string[]} keywords   - derived from title/category for matching
// @property {string} networkLink  - the actual affiliate tracking/deep link for this product
// @property {string} pitch        - a short description, used the same way a brand's manual pitch is

// Maps a free-text category string from a feed into the app's fixed
// category taxonomy. Defaults to "other" rather than guessing wrong,
// since an incorrect category only affects matching quality, not safety.
const CATEGORY_KEYWORDS = {
  outdoor: ["outdoor", "hiking", "camping", "travel bag", "backpack", "trek"],
  electronics: ["electronics", "headphone", "audio", "laptop", "phone", "computer", "tech"],
  beauty: ["beauty", "skincare", "cosmetic", "makeup", "fragrance"],
  home: ["home", "kitchen", "furniture", "decor", "appliance"],
  // Added after validating against a real Awin feed (women's clothing
  // advertiser) — without this, all apparel fell to "other".
  fashion: ["clothing", "dress", "skirt", "apparel", "fashion", "footwear", "shoes", "jeans", "denim", "accessories"],
};

export function mapCategory(rawCategoryOrTitle) {
  const text = (rawCategoryOrTitle || "").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return "other";
}

// Derives simple keyword tags from a product title for the existing
// keyword-matching logic in lib/listingMatcher.js to use — same matching
// mechanism as manually submitted listings, no special-casing needed.
export function deriveKeywords(title, category) {
  const words = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);
  return Array.from(new Set([...words, category]));
}
