// lib/quickCommerce.js
//
// Phase 1 of the quick-commerce handoff: for everyday items that 10-minute
// delivery apps typically stock, show "Need it fast?" links to each app's own
// search page, so a shopper can take our research straight there.
//
// What this is and is not:
//   * Plain search links. No affiliate tag, no data feed, no integration, and
//     we earn nothing from them — the UI says so. Quick-commerce price, stock
//     and delivery time depend on the shopper's location, which only each app
//     knows, so we neither show nor claim any of those.
//   * Only a generic product term (e.g. "whey protein") is ever put in the
//     link — never the shopper's full question, identity or budget.
//   * Every click goes through /qc, which records the platform (and nothing
//     else) before redirecting, so we learn whether the handoff is wanted.
//
// URL patterns, verified 2026-10-22:
//   Blinkit   confirmed in a real browser (page title "Buy <term> Online").
//   Zepto     NOT confirmed — a test load landed on the home page. Best-known
//             pattern; check it by hand.
//   Instamart NOT confirmed — site blocked automated checks. Best-known
//             pattern; check it by hand.
// QC_PLATFORMS (comma list, default all three) switches any of them off
// without a code change, e.g. QC_PLATFORMS=blinkit.

export const QC_PLATFORMS = {
  blinkit: {
    name: "Blinkit",
    url: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`,
  },
  zepto: {
    name: "Zepto",
    url: (q) => `https://www.zepto.com/search?query=${encodeURIComponent(q)}`,
  },
  instamart: {
    name: "Instamart",
    url: (q) => `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(q)}`,
  },
};

export function enabledPlatforms() {
  const wanted = (process.env.QC_PLATFORMS || "blinkit,zepto,instamart")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => QC_PLATFORMS[s]);
  return wanted;
}

// A short generic search term: letters, digits and basic punctuation only.
export function cleanTerm(raw) {
  return String(raw || "")
    // \p{M} keeps combining marks, which Indian-script words (e.g. Devanagari
    // vowel signs) are made of.
    .replace(/[^\p{L}\p{M}\p{N}\s&'+.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function buildQuickCommerceUrl(platform, term) {
  const p = QC_PLATFORMS[platform];
  const t = cleanTerm(term);
  return p && t ? p.url(t) : null;
}

// What the research route sends to the browser: null unless the category is
// one these apps stock and we have a term to search for.
export function quickCommercePayload(intent) {
  if (!intent?.quickCommerceFit) return null;
  const term = cleanTerm(intent.productType);
  const platforms = enabledPlatforms();
  if (!term || !platforms.length) return null;
  return {
    term,
    platforms: platforms.map((id) => ({ id, name: QC_PLATFORMS[id].name })),
  };
}
