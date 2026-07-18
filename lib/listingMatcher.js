// lib/listingMatcher.js
//
// Deliberate design: this file's output is the ONLY thing that ever gets
// passed into the Anthropic API call for a sponsored match. It returns
// product, brand, and price — and nothing else. Network, networkLink, and
// any commission-related fields are stripped out here, before the request
// to /api/research ever builds its prompt. This is what makes the "honest
// recommendation" promise structural rather than just a prompt instruction:
// the model is never given the data it would need to be swayed by.

// Generic shopping words that carry no product signal. Without this list a
// listing titled "Best Teacher Gift Basket" gets "best" as a keyword and then
// matches "best whey protein" — a real bug that put a food hamper under a
// protein query. A sponsored match that obviously doesn't fit does more
// damage to trust than showing no match at all, so we exclude these outright.
const STOPWORDS = new Set([
  "best", "top", "good", "great", "better", "cheap", "cheapest", "affordable",
  "buy", "shop", "shopping", "sale", "deal", "deals", "offer", "offers",
  "price", "prices", "under", "over", "for", "the", "and", "with", "from",
  "new", "review", "reviews", "vs", "versus", "recommended", "quality",
  "other", "india", "online", "item", "items", "options", "option",
]);
// Note: words like "gift", "kit" or "set" are deliberately NOT stopwords —
// they describe what a product actually is, so "gift ideas for a teacher"
// should be able to match a gift basket. Only query-filler words are excluded.

// Word-boundary match so "art" doesn't match "cart" and "tea" doesn't match
// "steam". Multi-word keywords ("whey protein") are strong signals and score
// double, since they can't collide by accident the way single words can.
function keywordScore(query, keyword) {
  const kw = keyword.toLowerCase().trim();
  if (!kw || kw.length < 3) return 0;
  if (STOPWORDS.has(kw)) return 0;

  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i");
  if (!boundary.test(query)) return 0;

  return kw.includes(" ") ? 2 : 1;
}

// A single weak word is not enough to justify showing a paid placement.
const MIN_MATCH_SCORE = 2;

export function findMatchingListing(queryText, approvedListings) {
  const q = (queryText || "").toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const listing of approvedListings || []) {
    // Defensive: a listing whose keywords column is NULL (or not an array)
    // used to throw "keywords is not iterable" here, which failed the whole
    // research request with a generic error — one bad row taking down every
    // search. Skip malformed rows instead.
    const keywords = Array.isArray(listing?.keywords) ? listing.keywords : [];
    let score = 0;
    for (const kw of keywords) {
      if (typeof kw !== "string") continue;
      score += keywordScore(q, kw);
    }
    if (score > bestScore) {
      bestScore = score;
      best = listing;
    }
  }

  // Below the threshold we show no sponsored match at all. The honest answer
  // still renders — it just isn't accompanied by a paid link that doesn't
  // genuinely fit the question.
  if (!best || bestScore < MIN_MATCH_SCORE) return null;

  // Strip down to only what the model is allowed to see.
  return {
    id: best.id,
    product: best.product,
    brand: best.brand,
    price: best.price,
  };
}

// Separately, build the full record (including the network link) that the
// CLIENT receives for rendering the "View and buy" button. This never goes
// near the Anthropic API call — it's assembled after the model has already
// returned its answer.
export function buildClientListingPayload(fullListing) {
  if (!fullListing) return null;
  return {
    id: fullListing.id,
    product: fullListing.product,
    brand: fullListing.brand,
    price: fullListing.price,
    pitch: fullListing.pitch,
    network: fullListing.network,
    networkLink: fullListing.networkLink,
  };
}
