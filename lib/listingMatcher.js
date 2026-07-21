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

// Extracts the meaningful terms from a query, used to pre-filter candidates in
// the database before precise scoring happens here. Mirrors the stopword and
// length rules below so the DB never discards something JS would have scored.
export function extractQueryTerms(queryText) {
  const q = (queryText || "").toLowerCase();
  const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const terms = new Set();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    terms.add(w);
  }
  // Adjacent word pairs, so multi-word keywords like "whey protein" are found.
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (words[i].length >= 3 && words[i + 1].length >= 3) terms.add(pair);
  }
  return Array.from(terms);
}

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

  // Weight by how specific the keyword is. A multi-word phrase ("whey
  // protein") can't collide by accident, and a longer single word
  // ("handbag", "moisturiser") is far more specific than a short one
  // ("bag", "top"), which could appear incidentally in a query. Short words
  // therefore need a second match before a paid placement is shown.
  if (kw.includes(" ")) return 2;
  return kw.length >= 6 ? 2 : 1;
}

// A single word is not enough to justify a paid placement, however specific
// it looks. "Speaker" appears in a projector's title as a component, and that
// alone put a ₹21,999 projector under a "bluetooth speaker under 1000" query.
// Requiring 3 means either a multi-word phrase plus a word, or several words
// — a real signal that the product is what was asked for.
const MIN_MATCH_SCORE = 3;

// Is this listing valid for the shopper's country?
// A listing with no regions recorded is treated as unrestricted — manual
// brand submissions have no geo data, and it's better to show them than to
// hide everything. Feed listings do carry regions, so those are enforced.
function servesCountry(listing, userCountry) {
  const regions = listing?.regions;
  if (!Array.isArray(regions) || regions.length === 0) return true;
  if (!userCountry) return true; // unknown location — don't filter blindly
  return regions.some((r) => String(r).toUpperCase() === userCountry.toUpperCase());
}


// Extracts a budget from the query ("under 1000", "below ₹2,500", "upto 500").
// A shopper who says "under 1000" has ruled out a ₹21,999 product entirely —
// no keyword overlap should be able to override that.
export function extractBudget(queryText) {
  const q = (queryText || "").toLowerCase().replace(/[,₹]/g, "");
  const m = q.match(/\b(?:under|below|less than|within|upto|up to|max|budget of)\s*(?:rs\.?|inr|\$|£)?\s*(\d{2,7})\b/);
  if (m) return Number(m[1]);
  return null;
}

// Parses "₹1,299" / "GBP14.99" / "$60" into a number for comparison.
function priceValue(price) {
  if (!price) return null;
  const digits = String(price).replace(/[^0-9.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function findMatchingListing(queryText, approvedListings, userCountry = null) {
  const q = (queryText || "").toLowerCase();
  const budget = extractBudget(queryText);
  let best = null;
  let bestScore = 0;

  for (const listing of approvedListings || []) {
    // Skip offers that aren't available where the shopper is. Showing a
    // UK-only merchant's GBP prices to a shopper in India is a broken
    // recommendation even when the keywords match perfectly.
    if (!servesCountry(listing, userCountry)) continue;

    // Respect a stated budget. A ₹21,999 projector matched "bluetooth speaker
    // under 1000" purely because "Speaker" appeared in its title — a product
    // 22x over budget should never have been a candidate at all. Allow a
    // little headroom for sale prices, but not orders of magnitude.
    if (budget) {
      const p = priceValue(listing.price);
      if (p && p > budget * 1.15) continue;
    }

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
    if (score === 0) continue;

    // Relevance decides IF a product can appear; ratings decide WHICH of
    // several equally relevant products does. A 4.3-star item with 900
    // ratings is demonstrably good at its job — a far better signal than
    // price, which says nothing about whether a thing works.
    //
    // Deliberately a small nudge, not a reranking: a slightly better-rated
    // product should never outrank a clearly more relevant one, or we'd be
    // answering a different question than the one asked.
    const rating = Number(listing.rating);
    const count = Number(listing.ratingCount);
    let quality = 0;
    if (Number.isFinite(rating) && rating > 0) {
      // 3 stars is the neutral point; 5 stars adds 0.4, 1 star subtracts 0.4.
      quality += (rating - 3) * 0.2;
      // Confidence in that rating grows with how many people left one, but
      // saturates — 50 ratings tells you most of what 5,000 would.
      if (Number.isFinite(count) && count > 0) {
        quality += Math.min(Math.log10(count + 1) / 10, 0.3);
      }
    }
    const effective = score + quality;

    if (effective > bestScore) {
      bestScore = effective;
      best = listing;
    }
  }

  // Below the threshold we show no sponsored match at all. The honest answer
  // still renders — it just isn't accompanied by a paid link that doesn't
  // genuinely fit the question.
  // Floor the score before comparing: the quality nudge must not lift a
  // product over the relevance threshold it wouldn't otherwise clear.
  if (!best || Math.floor(bestScore) < MIN_MATCH_SCORE) return null;

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
    imageUrl: fullListing.imageUrl || null,
    // Shown next to the button so the shopper can see the destination before
    // clicking, rather than discovering it after a redirect.
    merchantDomain: fullListing.merchantDomain || null,
    discount: fullListing.discount || null,
    rating: fullListing.rating != null ? Number(fullListing.rating) : null,
    ratingCount: fullListing.ratingCount != null ? Number(fullListing.ratingCount) : null,
  };
}
