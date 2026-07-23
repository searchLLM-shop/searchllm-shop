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
  // Budget-phrase filler. "around" cost us dearly: a "tv AROUND 3L" query
  // matched a "Wrap AROUND Skirt" title on that word alone, and "around" is
  // long enough that the length heuristic called it specific. Words that
  // describe the budget, not the product, must never score.
  "around", "about", "approx", "approximately", "roughly", "nearly", "near",
  "budget", "cost", "costs", "rupees", "lakh", "lakhs", "within", "upto",
  "below", "less", "than", "max", "maximum", "min", "minimum",
]);

import { isBlockedListing, hasAdultContext, mentionsMinors } from "@/lib/contentFilter";

// A deliberately tiny synonym map for cases where the shopper's word and
// the catalogue's word are reliably different words for the same thing.
// Kept small on purpose: every entry here widens matching, and a wrong
// synonym would put wrong products in front of the model. Extend only when
// a real query pattern demands it (the Queries tab shows exactly that).
// Words that describe WHERE or FOR WHOM, not WHAT. They carry a little
// signal (a "living room" query genuinely prefers living-room products)
// but production showed them dominating: decor items with enriched
// "living room" keywords outscored actual TVs on a "75 inch tv for a
// living room" query. Context contributes at most 1 point in total.
const CONTEXT_WORDS = new Set([
  "living", "room", "bedroom", "kitchen", "bathroom", "office", "home",
  "hall", "balcony", "outdoor", "indoor", "family", "living room",
]);

const TERM_ALIASES = {
  television: ["tv"],
  tv: ["television"],
  fridge: ["refrigerator"],
  refrigerator: ["fridge"],
  gamepad: ["controller"],
  controller: ["gamepad"],
  // Spelling variants of the same word — common in transliterated Hindi
  // shopping terms, where no single canonical spelling exists.
  uptan: ["ubtan"],
  ubtan: ["uptan"],
  earbuds: ["earphones"],
  earphones: ["earbuds"],
};

// The reverse of pair-joining: shoppers write compounds the catalogue
// splits. "facewash" must find "Face Wash", "bodywash" must find "Body
// Wash", "smartwatch" must find "Smart Watch". No dictionary exists here,
// so the heuristic is conservative — only words of 8+ letters, split into
// halves of 4+ letters each. Wrong splits ("television" → "tele"+"vision")
// cost nothing downstream: a candidate retrieved on a junk half still has
// to earn a real score against the query, which it can't.
function splitCompoundHalves(word) {
  if (word.length < 8) return [];
  const halves = [];
  for (let i = 4; i <= word.length - 4; i++) {
    halves.push(word.slice(0, i), word.slice(i));
  }
  return Array.from(new Set(halves));
}

// Extracts the meaningful terms from a query, used to pre-filter candidates in
// the database before precise scoring happens here. Mirrors the stopword and
// length rules below so the DB never discards something JS would have scored.
export function extractQueryTerms(queryText) {
  const q = (queryText || "").toLowerCase();
  const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const terms = new Set();
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    // 2-letter words are noise except real product words (tv, via the
    // alias whitelist) and NUMBERS: "75" is the most discriminating token
    // in "75 inch tv" — present in every real 75-inch title, absent from
    // every cover and cabinet.
    if (w.length < 3 && !TERM_ALIASES[w] && !/^\d{2,}$/.test(w)) continue;
    terms.add(w);
    for (const alias of TERM_ALIASES[w] || []) terms.add(alias);
    for (const half of splitCompoundHalves(w)) terms.add(half);
  }
  // Adjacent word pairs, so multi-word keywords like "whey protein" are found
  // — and their JOINED form, so "game pad" can find a product titled
  // "Gamepad". Compounding is rampant in product titles; queries split them.
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length >= 3 && words[i + 1].length >= 3) {
      terms.add(`${words[i]} ${words[i + 1]}`);
      const joined = `${words[i]}${words[i + 1]}`;
      if (joined.length >= 6 && !STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1])) terms.add(joined);
    }
  }
  return Array.from(terms);
}

// The scorer tests keywords against the query STRING, so the same widening
// has to happen there: append joined adjacent pairs and aliases to the query
// once, and every keyword test sees them. "a good game pad" becomes
// "... gamepad ..." so the keyword "gamepad" can hit.
function augmentQueryForScoring(q) {
  const words = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const extras = [];
  for (const w of words) {
    for (const alias of TERM_ALIASES[w] || []) extras.push(alias);
    if (!STOPWORDS.has(w)) extras.push(...splitCompoundHalves(w));
  }
  for (let i = 0; i < words.length - 1; i++) {
    const joined = `${words[i]}${words[i + 1]}`;
    if (joined.length >= 6 && !STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1])) extras.push(joined);
  }
  return extras.length ? `${q} ${extras.join(" ")}` : q;
}

// Note: words like "gift", "kit" or "set" are deliberately NOT stopwords —
// they describe what a product actually is, so "gift ideas for a teacher"
// should be able to match a gift basket. Only query-filler words are excluded.

// Word-boundary match so "art" doesn't match "cart" and "tea" doesn't match
// "steam". Multi-word keywords ("whey protein") are strong signals and score
// double, since they can't collide by accident the way single words can.
function keywordScore(query, keyword) {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return 0;
  // Pure numbers (sizes, capacities): "75" separates a 75-inch TV from a
  // TV cover better than any word. Exact-boundary match, worth 1.
  if (/^\d{2,}$/.test(kw)) {
    return new RegExp(`(^|\\D)${kw}(\\D|$)`).test(query) ? 1 : 0;
  }
  if (kw.length < 3) return 0;
  if (STOPWORDS.has(kw)) return 0;

  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Plural-tolerant: "protein powder" should match a query saying "protein
  // powders", and the keyword "powders" should match a query saying
  // "powder". Full-text search finds these candidates via stemming, so the
  // scorer must not then reject them over an s/es suffix. Anything beyond
  // simple plurals stays out — this is a matcher, not a stemmer.
  const boundary = new RegExp(`(^|\\W)${escaped}(?:s|es)?(\\W|$)`, "i");
  let hit = boundary.test(query);
  // Multi-word keyword vs compound query: "game pad" should hit "gamepad".
  if (!hit && kw.includes(" ")) {
    const joined = kw.replace(/\s+/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (joined.length >= 6) hit = new RegExp(`(^|\\W)${joined}(?:s|es)?(\\W|$)`, "i").test(query);
  }
  if (!hit && kw.length >= 5 && kw.endsWith("s")) {
    const stem = kw.replace(/es$|s$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (stem.length >= 3) hit = new RegExp(`(^|\\W)${stem}(?:s|es)?(\\W|$)`, "i").test(query);
  }
  if (!hit) return 0;

  // Weight by how specific the keyword is. A multi-word phrase ("whey
  // protein") can't collide by accident, and a longer single word
  // ("handbag", "moisturiser") is far more specific than a short one
  // ("bag", "top"), which could appear incidentally in a query. Short words
  // therefore need a second match before a paid placement is shown.
  if (kw.includes(" ")) return 2;
  return kw.length >= 6 ? 2 : 1;
}

// A single short word is not enough to shortlist a product, however specific
// it looks. "Speaker" appears in a projector's title as a component, and that
// alone put a ₹21,999 projector under a "bluetooth speaker under 1000" query.
// 2 means one strong signal (a multi-word phrase or a long specific word) or
// two short words. This is deliberately looser than the old 3: the model now
// chooses among the shortlist (or rejects all of it), so the mechanical gate
// only has to keep the obviously wrong out — the projector case is still
// caught, first by the budget hard filter and then by the model's judgment.
const MIN_MATCH_SCORE = 2;

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
  // Two budget shapes with different meanings:
  //   "under/below/upto X"  → a CEILING. Anything priced under X qualifies,
  //                           however cheap — the shopper set a maximum only.
  //   "around/about/approx X" → a TARGET. The shopper is telling us their
  //                           price CLASS: for "a tv around 3L", a ₹699 TV
  //                           cover is not an answer, it's an accessory that
  //                           happens to share a word. A generous window
  //                           (40%–125% of the figure) keeps genuinely
  //                           cheaper-but-same-class products in play.
  // Indian notation supported in both: "50k", "1L", "1.5 lakh".
  const m = q.match(/\b(under|below|less than|within|upto|up to|max|budget of|around|about|approx|approximately|roughly)\s*(?:rs\.?|inr|\$|£)?\s*(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs|lac)?\b/);
  if (!m) return null;
  const kind = m[1];
  const unit = (m[3] || "").toLowerCase();
  let value = Number(m[2]);
  if (unit === "k") value *= 1000;
  else if (unit) value *= 100000;
  // Without a unit, a 1-digit "budget" is almost certainly not one
  // ("under 5 stars"), which is why the original pattern required 2+ digits.
  if (!unit && m[2].length < 2) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  const isTarget = ["around", "about", "approx", "approximately", "roughly"].includes(kind);
  // 55%, not lower: production showed a 40% floor admits a cluster of
  // under-class products ("around ₹1L" pulled in ₹41K 43-inch TVs) that
  // then anchors the model's judgment toward rejecting the whole shortlist.
  // Nobody saying "around 1L" means 41K; 55% keeps same-class value picks
  // (₹79,990 for a 1L target) while cutting the class below.
  return isTarget
    ? { max: value * 1.25, min: value * 0.55 }
    : { max: value, min: null };
}

// Parses "₹1,299" / "GBP14.99" / "$60" into a number for comparison.
function priceValue(price) {
  if (!price) return null;
  const digits = String(price).replace(/[^0-9.]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function findMatchingListing(queryText, approvedListings, userCountry = null) {
  const top = findTopMatchingListings(queryText, approvedListings, userCountry, 1);
  return top.length ? top[0].listing : null;
}

// Scores every servable listing against the query and returns the top N as
// { listing, score } — the shortlist the MODEL then chooses from (or rejects
// entirely). This split is deliberate: the mechanical score is a RECALL
// gate that only has to keep obviously-wrong products out, because the
// model is the precision gate — it decides which single candidate, if any,
// genuinely answers the question, judged as if no money were involved.
export function findTopMatchingListings(queryText, approvedListings, userCountry = null, limit = 4) {
  // Restricted-category listings (prescription medicines, weapons, tobacco,
  // adult products — see contentFilter.js) can never be shortlisted, even
  // when they exist in approved inventory: 169K bulk-approved feed rows were
  // never individually read, so the inventory cannot be assumed clean.
  approvedListings = (approvedListings || []).filter(
    (l) => !isBlockedListing(`${l?.product || ""} ${l?.brand || ""} ${l?.category || ""}`)
  );
  // Sexual/suggestive query → children's products are structurally absent
  // from the shortlist, whatever the inventory contains. A kids' query
  // WITHOUT adult context ("party dress for my 8 year old") matches kids'
  // products normally — the exclusion is conditional on the query, not a
  // blanket ban on children's inventory.
  if (hasAdultContext(queryText)) {
    approvedListings = approvedListings.filter(
      (l) => !mentionsMinors(`${l?.product || ""} ${l?.brand || ""} ${l?.category || ""}`)
    );
  }
  const q = augmentQueryForScoring((queryText || "").toLowerCase());
  const budget = extractBudget(queryText);
  const scored = [];

  for (const listing of approvedListings || []) {
    // Skip offers that aren't available where the shopper is. Showing a
    // UK-only merchant's GBP prices to a shopper in India is a broken
    // recommendation even when the keywords match perfectly.
    if (!servesCountry(listing, userCountry)) continue;

    // Respect a stated budget — a HARD filter no model judgment overrides.
    // Ceiling: a ₹21,999 projector matched "bluetooth speaker under 1000"
    // purely because "Speaker" appeared in its title — a product 22x over
    // budget should never be a candidate. Small headroom for sale prices.
    // Floor (target budgets only): "a tv around 3L" must not shortlist a
    // ₹699 TV cover — an accessory sharing a word is not the price class
    // the shopper named.
    if (budget) {
      const p = priceValue(listing.price);
      // Ceilings get 15% headroom for sale-price drift. Target windows
      // ("around 1L") already carry their own headroom (×1.25 in
      // extractBudget) — compounding both let a product 44% over a stated
      // target reach the model, so the window applies as-is.
      const hardMax = budget.min ? budget.max : budget.max * 1.15;
      if (p && p > hardMax) continue;
      if (p && budget.min && p < budget.min) continue;
    }

    // Defensive: a listing whose keywords column is NULL (or not an array)
    // used to throw "keywords is not iterable" here, which failed the whole
    // research request with a generic error — one bad row taking down every
    // search. Skip malformed rows instead.
    //
    // Score against the keywords PLUS the words of the title and brand.
    // deriveKeywords caps at 8 title words, so a longer title can carry a
    // word the shopper searched that never made the keywords array — and
    // full-text search (which found this candidate via the title) would be
    // pointless if scoring then ignored the title. Deduped, and run through
    // the same word-boundary scorer, so junk short tokens still score zero.
    const keywords = Array.isArray(listing?.keywords) ? listing.keywords : [];
    const titleTokens = `${listing?.product || ""} ${listing?.brand || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      // Short tokens are noise except real product words (tv) and numbers
      // — same rules as extractQueryTerms.
      .filter((w) => w.length > 3 || TERM_ALIASES[w] || /^\d{2,}$/.test(w));
    // Expand aliases listing-side as well: a title saying "Smart TV" must be
    // scorable against a query saying "television", and vice versa.
    const aliasTokens = [];
    for (const t of [...keywords, ...titleTokens]) {
      if (typeof t === "string") for (const a of TERM_ALIASES[t] || []) aliasTokens.push(a);
    }
    const scorable = Array.from(new Set([...keywords, ...titleTokens, ...aliasTokens]));
    let score = 0;
    let contextScore = 0;
    for (const kw of scorable) {
      if (typeof kw !== "string") continue;
      const pts = keywordScore(q, kw);
      if (pts === 0) continue;
      // Context words (living, room, home…) locate a product; they must
      // never BE the product. Production: decor with enriched "living
      // room" keywords outscored actual TVs on a "75 inch tv for a living
      // room" query. Their combined contribution caps at 1.
      if (CONTEXT_WORDS.has(kw.toLowerCase().trim())) contextScore += pts;
      else score += pts;
    }
    score += Math.min(contextScore, 1);
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
    scored.push({ listing, score: effective });
  }

  // Below the threshold no candidate is offered at all. The honest answer
  // still renders — it just isn't accompanied by a paid link that doesn't
  // plausibly fit the question. The threshold is a RECALL gate (2, not the
  // old 3): a near-miss now goes to the model, which judges it properly,
  // instead of dying on a mechanical technicality. Budget and geography
  // above remain hard filters — no model judgment can override those.
  // Floor the score before comparing: the quality nudge must not lift a
  // product over the relevance threshold it wouldn't otherwise clear.
  const qualified = scored
    .filter((s) => Math.floor(s.score) >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Strip each candidate down to only what the model is allowed to see.
  return qualified.map(({ listing, score }) => ({
    score,
    listing: {
      id: listing.id,
      product: listing.product,
      brand: listing.brand,
      price: listing.price,
      rating: listing.rating,
      ratingCount: listing.ratingCount,
    },
  }));
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
