// lib/slug.js
//
// Turns a generic topic into a URL slug. Deliberately built from the model's
// generalised topic ("best whey protein under 2000") rather than the user's
// raw query, so a published page never exposes how an individual phrased
// their question — which could carry personal detail the Privacy Policy
// promises not to publish.

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}
