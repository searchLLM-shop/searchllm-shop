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

import { isBlockedListing, mentionsMinors } from "@/lib/contentFilter";

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
// Indian notation shared by every budget shape below: "50k", "1L", "1.5 lakh".
function toAmount(numStr, unitStr) {
  const unit = (unitStr || "").toLowerCase();
  let value = Number(numStr);
  if (unit === "k") value *= 1000;
  else if (unit) value *= 100000;
  return { value, unit, digits: numStr.length };
}

export function extractBudget(queryText) {
  const q = (queryText || "").toLowerCase().replace(/[,₹]/g, "");

  // An EXPLICIT range ("5000-10000", "₹5,000–10,000", "50k to 1L") — no
  // keyword needed, and checked first since it's the most specific shape.
  // Real gap, found 2026-09-18: a query stating "₹5,000–10,000" fell
  // through to the keyword-based patterns below, matched none of them (no
  // "under"/"around"), and the shopper's stated budget was silently
  // dropped entirely — every listing stayed in play regardless of price.
  // An exact range needs no target-window heuristic; both ends are given.
  const rangeMatch = q.match(
    /\b(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs|lac)?\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs|lac)?\b/
  );
  if (rangeMatch) {
    const lo = toAmount(rangeMatch[1], rangeMatch[2]);
    const hi = toAmount(rangeMatch[3], rangeMatch[4] || rangeMatch[2]); // "5-10k" → both k
    // Same false-positive guard in spirit as the keyword branch's 2+ digit
    // rule below — a bare "X to Y" has no keyword anchoring it to money at
    // all, so without SOME size/unit floor this would misfire on a size
    // range ("32 to 38"), a rating ("3 to 5 stars"), or a model comparison
    // ("15 to 16"). A unit (k/lakh) on either side is unambiguous either
    // way; without one, require a realistic rupee figure (100+).
    const hasUnit = Boolean(lo.unit || hi.unit);
    if (
      Number.isFinite(lo.value) && Number.isFinite(hi.value) &&
      lo.value > 0 && hi.value > lo.value &&
      (hasUnit || lo.value >= 100)
    ) {
      return { min: lo.value, max: hi.value };
    }
  }

  // Two budget shapes with different meanings:
  //   "under/below/upto X"  → a CEILING. Anything priced under X qualifies,
  //                           however cheap — the shopper set a maximum only.
  //   "around/about/approx X" → a TARGET. The shopper is telling us their
  //                           price CLASS: for "a tv around 3L", a ₹699 TV
  //                           cover is not an answer, it's an accessory that
  //                           happens to share a word. A generous window
  //                           (40%–125% of the figure) keeps genuinely
  //                           cheaper-but-same-class products in play.
  const m = q.match(/\b(under|below|less than|within|upto|up to|max|budget of|around|about|approx|approximately|roughly)\s*(?:rs\.?|inr|\$|£)?\s*(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs|lac)?\b/);
  if (!m) return null;
  const kind = m[1];
  const { value, unit, digits } = toAmount(m[2], m[3]);
  // Without a unit, a 1-digit "budget" is almost certainly not one
  // ("under 5 stars"), which is why the original pattern required 2+ digits.
  if (!unit && digits < 2) return null;
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

// --- Colour requirements (2026-10-05) -------------------------------------
//
// Found live: "maroon cotton kurta for women under 1500" got a TURQUOISE
// kurta as its pick, and neither of the extras was maroon either. Myntra
// titles don't carry colour — it lives only in the listing's `pitch`
// ("Turquoise Blue kurta - Embroidered - ..."). The pitch is in the
// full-text index, but this scorer never read it and the answering model
// never saw it, so nothing in the pipeline could tell a maroon kurta from
// a turquoise one. The prompt calls stated attributes hard requirements;
// without the data, that was unenforceable.
//
// So: where a colour is requested, a listing whose own text shows that
// colour gets a boost, and one whose text names ONLY other colours is
// demoted hard (it stays eligible only when the catalogue has nothing
// better, and the model — now shown the description — makes the final
// call). A listing that names no colour at all is left alone: we can't
// tell, so we don't guess. Gated to browse categories by the caller:
// "green tea", "black pepper" and "face cream" are not colour queries.
const COLOUR_FAMILIES = {
  maroon: ["maroon", "burgundy", "wine", "oxblood", "claret"],
  red: ["red", "scarlet", "crimson", "cherry"],
  pink: ["pink", "rose", "blush", "fuchsia", "magenta", "salmon"],
  orange: ["orange", "rust", "coral", "peach", "tangerine"],
  yellow: ["yellow", "mustard", "lemon"],
  green: ["green", "olive", "mint", "lime", "emerald", "sage"],
  teal: ["teal", "turquoise", "aqua", "cyan"],
  blue: ["blue", "navy", "cobalt", "indigo", "denim"],
  purple: ["purple", "violet", "lavender", "lilac", "mauve", "plum"],
  brown: ["brown", "coffee", "chocolate", "walnut"],
  beige: ["beige", "nude", "khaki", "camel", "taupe", "sand", "tan", "stone"],
  white: ["white", "ivory", "cream", "off[ -]?white"],
  grey: ["grey", "gray", "charcoal"],
  black: ["black"],
  gold: ["gold", "golden"],
  silver: ["silver"],
};
// What a SHOPPER can ask for. Deliberately narrower than the aliases
// above: "cream", "rose", "wine", "coffee", "mint", "lime", "plum" and
// "peach" are also products and flavours, so they only count when a
// LISTING uses them to describe its colour, never as a query trigger.
const QUERY_COLOUR_WORDS = {
  red: "red", maroon: "maroon", burgundy: "maroon", pink: "pink", orange: "orange",
  yellow: "yellow", mustard: "yellow", green: "green", olive: "green", teal: "teal",
  turquoise: "teal", blue: "blue", navy: "blue", purple: "purple", violet: "purple",
  lavender: "purple", brown: "brown", beige: "beige", grey: "grey", gray: "grey",
  black: "black", white: "white", ivory: "white", gold: "gold", silver: "silver",
};
const COLOUR_FAMILY_REGEX = Object.fromEntries(
  Object.entries(COLOUR_FAMILIES).map(([fam, aliases]) => [fam, new RegExp(`\\b(?:${aliases.join("|")})\\b`, "i")])
);

export function requestedColourFamilies(queryText) {
  const out = new Set();
  for (const w of String(queryText || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (QUERY_COLOUR_WORDS[w]) out.add(QUERY_COLOUR_WORDS[w]);
  }
  return out;
}

// Which colour families a listing's own text names. Brand is stripped from
// the title first: "Red Tape" is a brand, not a red product.
export function colourFamiliesIn(listing) {
  let title = String(listing?.product || "");
  const brand = String(listing?.brand || "").trim();
  if (brand.length >= 3) {
    title = title.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  const text = `${title} ${listing?.pitch || ""}`;
  return new Set(Object.keys(COLOUR_FAMILIES).filter((fam) => COLOUR_FAMILY_REGEX[fam].test(text)));
}

// Score adjustment for one listing against the requested colours.
export function colourAdjustment(requested, listing) {
  if (!requested || requested.size === 0) return 0;
  const has = colourFamiliesIn(listing);
  if (has.size === 0) return 0; // names no colour — can't tell, don't guess
  for (const fam of requested) if (has.has(fam)) return 3;
  return -6; // names colours, none of them the one asked for
}

// --- Price spread (2026-10-05) ----------------------------------------------
//
// Found live: "white sneakers for men under 3000" surfaced ₹868–₹1,699
// options only. The ranking has no notion of price — relevance, then a
// small rating nudge — so on a feed where cheap mass-market brands carry
// thousands of ratings, they win every tie, and a shopper who said they'd
// spend up to ₹3,000 never sees what ₹2,500 buys. A stated budget is a
// CEILING (or a target window), not a target to undershoot, so when one
// exists the shortlist the model chooses from deliberately spans the
// range: among listings nearly as relevant as the best, take the best
// from each third of the budget — upper third first.
//
// Relevance still gates everything (a far-less-relevant listing never
// gets in just for its price), and the final list is re-sorted by score,
// never by price, so nothing here steers toward expensive or cheap.
const PRICE_SPREAD_RELEVANCE_SLACK = 2.5;

export function spreadByPrice(sortedByScore, budget, limit) {
  if (!budget || !Number.isFinite(budget.max) || limit < 3 || sortedByScore.length <= limit) {
    return sortedByScore.slice(0, limit);
  }
  const top = sortedByScore[0].score;
  const pool = sortedByScore.filter((s) => s.score >= top - PRICE_SPREAD_RELEVANCE_SLACK);
  const lo = budget.min || 0;
  const span = budget.max - lo;
  if (!(span > 0)) return sortedByScore.slice(0, limit);

  const bands = [[], [], []];
  for (const s of pool) {
    const p = priceValue(s.listing.price);
    if (p == null) continue;
    const idx = Math.min(2, Math.max(0, Math.floor(((p - lo) / span) * 3)));
    bands[idx].push(s); // pool is already score-descending
  }
  if (bands.reduce((n, b) => n + b.length, 0) < 3) return sortedByScore.slice(0, limit);

  const picked = [];
  const taken = new Set();
  const cursors = [0, 0, 0];
  // Upper band first, then middle, then lower, round-robin until full.
  while (picked.length < limit && [2, 1, 0].some((b) => cursors[b] < bands[b].length)) {
    for (const b of [2, 1, 0]) {
      if (picked.length >= limit) break;
      if (cursors[b] < bands[b].length) {
        const s = bands[b][cursors[b]++];
        picked.push(s);
        taken.add(s);
      }
    }
  }
  // Anything still unfilled (unpriced or outside-pool) comes back by score.
  for (const s of sortedByScore) {
    if (picked.length >= limit) break;
    if (!taken.has(s)) picked.push(s);
  }
  return picked.sort((a, b) => b.score - a.score);
}

// A short slice of the retailer's own product description — where colour,
// fabric and fit actually live for feeds whose titles omit them. Only ever
// for FEED listings: a manually submitted brand listing's pitch is the
// brand's own marketing copy, which the answering model must not be fed.
function descriptionSnippet(listing) {
  if (listing?.source !== "feed") return undefined;
  const s = String(listing.pitch || "").replace(/\s+/g, " ").trim().slice(0, 140);
  return s || undefined;
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
// A candidate's own text (title/brand/keywords) containing a word from the
// AI-extracted core product type ("maxi dress", "smart tv", "liquid
// detergent" — lib/queryIntent.js's productType). Deliberately separate
// from keywordScore: that function tests whether a LISTING's own keyword
// appears in the QUERY; this tests the other direction, and only for the
// handful of words naming what's actually being shopped for.
function productTypeWords(productType) {
  if (typeof productType !== "string" || !productType.trim()) return [];
  return productType
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}
function matchesProductType(listingText, typeWords) {
  if (!typeWords.length) return false;
  const t = ` ${listingText.toLowerCase()} `;
  return typeWords.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `) || t.includes(` ${w}es `));
}

// opts.colourMatching: apply the colour requirement logic above. The
// caller turns it on only for browse-style categories (clothes, shoes,
// bags...) — never for groceries or beauty, where "green", "cream" or
// "black" name a product, not a colour.
export function findTopMatchingListings(queryText, approvedListings, userCountry = null, limit = 4, productType = null, opts = {}) {
  // Restricted-category listings (prescription medicines, weapons, tobacco,
  // adult products — see contentFilter.js) can never be shortlisted, even
  // when they exist in approved inventory: 169K bulk-approved feed rows were
  // never individually read, so the inventory cannot be assumed clean.
  approvedListings = (approvedListings || []).filter(
    (l) => !isBlockedListing(`${l?.product || ""} ${l?.brand || ""} ${l?.category || ""}`)
  );
  // Children's products are structurally absent from the shortlist by
  // DEFAULT — included only when the query itself names a minor audience
  // ("dress for my daughter", "girls dress", "school bag"). Inverted from
  // an earlier version that defaulted the other way and only excluded
  // minors when the query stated an adult audience ("women"/"men") or
  // sexual context (the original 2026-07-22 fix): that version still
  // failed on "red dress for party, Cocktail/semi-formal, M-L, Loose/
  // flowing, Knee-length" (2026-09-18) — a real shopper phrasing that
  // never says "women" at all because it's obviously implied, the same
  // way most adult shoppers phrase most queries. A general shopping
  // engine's sensible prior is that an unqualified query is for the adult
  // asking it, not a child, so minors are now the OPT-IN case rather than
  // the default-included one.
  if (!mentionsMinors(queryText)) {
    approvedListings = approvedListings.filter(
      (l) => !mentionsMinors(`${l?.product || ""} ${l?.brand || ""} ${l?.category || ""}`)
    );
  }
  const q = augmentQueryForScoring((queryText || "").toLowerCase());
  const budget = extractBudget(queryText);
  const typeWords = productTypeWords(productType);
  const requestedColours = opts.colourMatching ? requestedColourFamilies(queryText) : null;
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

    // Product-TYPE boost (2026-09-18): a large flat bonus when this
    // listing's own title/category/keywords contain a word from the
    // AI-extracted core product type ("dress", from productType "cocktail
    // dress") — found chasing the same "women red dress" query, one more
    // layer down: even with the audience fix above, "Women Solid Formal
    // Dark Green Shirt" (a SHIRT) and two "...Formal...Leather Belt"
    // listings still outscored genuine dresses, purely by sharing MORE
    // generic occasion words ("formal", "party") than this catalog's
    // terser dress titles do. Nothing in the scorer previously cared
    // whether a candidate was even the right kind of thing. +4 is enough
    // to reliably beat a few generic-word hits without being an outright
    // requirement — a candidate missing the type word can still qualify
    // on ordinary relevance, same recall-gate philosophy as everywhere
    // else in this function; the model is still the precision gate.
    // Deliberately excludes BRAND: caught in testing here, the brand "asia
    // dresses" made a plain shirt sail past this exact boost — a brand
    // name is not a reliable signal for what the product actually is.
    if (matchesProductType(`${listing?.product || ""} ${listing?.category || ""} ${keywords.join(" ")}`, typeWords)) {
      score += 4;
    }

    // Stated colour is a requirement, not a keyword (see the colour
    // section above) — boost a listing showing it, demote one showing
    // only other colours.
    if (requestedColours) score += colourAdjustment(requestedColours, listing);

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
  const ranked = scored
    .filter((s) => Math.floor(s.score) >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score);
  // With a stated budget, span it rather than take the top-N by relevance
  // alone (see spreadByPrice) — otherwise cheap, heavily-rated listings win
  // every tie and "under ₹3,000" quietly means "the cheapest things".
  const qualified = spreadByPrice(ranked, budget, limit);

  // Strip each candidate down to only what the model is allowed to see.
  // `description` is the retailer's own product text for FEED listings
  // only — where colour, fabric and fit live when titles omit them — never
  // network, link or commission, and never a brand's self-written pitch.
  return qualified.map(({ listing, score }) => ({
    score,
    listing: {
      id: listing.id,
      product: listing.product,
      brand: listing.brand,
      price: listing.price,
      rating: listing.rating,
      ratingCount: listing.ratingCount,
      description: descriptionSnippet(listing),
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
