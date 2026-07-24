// lib/track.js
//
// Client-side event instrumentation, in one place. Events are pushed to the
// GTM dataLayer; what consumes them (GA4, Meta Pixel) is configured in the
// GTM dashboard — the code stays vendor-neutral, and one instrumentation
// pass serves every measurement tool.
//
// PRIVACY CONTRACT (mirrors Privacy Policy 6AB): events describe what
// happened on OUR site — a search completed, a product link was clicked.
// They never carry the query text, personal identifiers, or anything that
// would let a third party profile the person. Aggregate behavior, not
// people.

export function trackEvent(name, params = {}) {
  try {
    if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...params });
    }
  } catch {
    // Analytics must never break the product.
  }
}
