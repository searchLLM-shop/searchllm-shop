// lib/moreChoices.js
//
// "More options in this range" for browse-style categories (clothes,
// shoes, bags, jewellery, decor, gifts) — where shoppers genuinely want a
// handful of real options to choose between, unlike spec-driven categories
// (electronics, appliances) where one sharp pick serves them better.
//
// The trade-off this resolves: the whole product is "don't bury people in
// products", so extras are tightly controlled —
//   * only in browse categories (lib/queryIntent.js's choiceMode; anything
//     else, including a failed classification, gets today's single pick),
//   * hard-capped (MAX_EXTRAS_BROWSE),
//   * nominated by the answering MODEL, which only ever sees id/title/
//     brand/price/rating — never the network or commission — so extras are
//     chosen on fit and variety, structurally unable to be chosen on payout,
//   * held to the same bar as the pick itself (every stated attribute, in
//     budget), with fewer-is-better-than-padding spelled out in the prompt,
//   * and re-validated here, because a model output is never trusted
//     blindly: ids must be ones we actually offered, can't repeat the
//     lead or each other, and duplicate titles are dropped.

export const MAX_EXTRAS_BROWSE = 3;

export function maxExtrasForMode(mode) {
  return mode === "browse" ? MAX_EXTRAS_BROWSE : 0;
}

// Lower-case, alphanumerics only — so "Women Maroon Kurta (XL)" and
// "women maroon kurta xl" count as the same title. Deliberately title-only:
// a brand-and-price check would wrongly cut real variety in fashion, where
// one brand routinely sells many different items at the same price.
function titleKey(listing) {
  return String(listing?.product || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// lead:        the full listing the model chose as its main pick (or null)
// rawIds:      whatever the model returned for alsoConsiderIds (untrusted)
// offeredIds:  Set of ids we actually put in front of the model
// candidatesById: Map(id -> full listing, incl. network link)
// max:         cap from maxExtrasForMode()
//
// Returns an array of FULL listings (the caller shapes them for the
// client), in the model's own order — never re-sorted by anything
// commercial.
export function pickMoreChoices({ lead, rawIds, offeredIds, candidatesById, max }) {
  if (!lead || !max || max <= 0 || !Array.isArray(rawIds)) return [];

  const seenIds = new Set([lead.id]);
  const seenTitles = new Set([titleKey(lead)]);
  const out = [];

  for (const raw of rawIds) {
    const id = Number(raw);
    if (!Number.isFinite(id) || seenIds.has(id) || !offeredIds.has(id)) continue;
    const listing = candidatesById.get(id);
    if (!listing) continue;

    const tk = titleKey(listing);
    // A different listing id for what is effectively the same product (a
    // colour/size variant row, or a duplicate feed entry) is clutter, not
    // choice.
    if (tk && seenTitles.has(tk)) continue;

    seenIds.add(id);
    seenTitles.add(tk);
    out.push(listing);
    if (out.length >= max) break;
  }
  return out;
}
