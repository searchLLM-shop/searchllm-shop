// lib/listingMatcher.js
//
// Deliberate design: this file's output is the ONLY thing that ever gets
// passed into the Anthropic API call for a sponsored match. It returns
// product, brand, and price — and nothing else. Network, networkLink, and
// any commission-related fields are stripped out here, before the request
// to /api/research ever builds its prompt. This is what makes the "honest
// recommendation" promise structural rather than just a prompt instruction:
// the model is never given the data it would need to be swayed by.

export function findMatchingListing(queryText, approvedListings) {
  const q = queryText.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const listing of approvedListings) {
    let score = 0;
    for (const kw of listing.keywords) {
      if (q.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = listing;
    }
  }

  if (!best) return null;

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
