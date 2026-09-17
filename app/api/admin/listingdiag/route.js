// app/api/admin/listingdiag/route.js
//
// Diagnoses "the matcher/affiliate link didn't work" reports (2026-09-17):
// runs the EXACT same candidate lookup + scoring the real /api/research
// route uses for a given query text, and reports Myntra/vCommission
// inventory health (approved count, how many are missing a usable
// network_link) — the two places a click-through can silently fail before
// it ever reaches the model or the /out/ redirect.
//
//   GET /api/admin/listingdiag?q=women+red+dress+for+a+party
//   GET /api/admin/listingdiag?health=1

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { query, findCandidateListings } from "@/lib/db";
import { findTopMatchingListings, extractQueryTerms } from "@/lib/listingMatcher";

export const maxDuration = 30;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const out = {};

  if (params.get("health")) {
    const byNetworkStatus = await query(`
      SELECT network, status, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE network_link IS NULL OR network_link = '')::int AS no_link
      FROM listings
      GROUP BY network, status
      ORDER BY n DESC
      LIMIT 30
    `);
    out.byNetworkStatus = byNetworkStatus.rows;

    const myntraSample = await query(`
      SELECT id, brand, product, category, keywords, status,
             (network_link IS NOT NULL AND network_link <> '') AS "hasLink"
      FROM listings
      WHERE network = 'vCommission' AND product ILIKE '%dress%'
      ORDER BY id DESC
      LIMIT 8
    `);
    out.myntraDressSample = myntraSample.rows;
    return Response.json(out);
  }

  if (params.get("probe")) {
    // Does the catalog actually contain approved women's dresses, or is the
    // "women red dress" query being outscored by children's dresses because
    // the catalog itself is skewed toward kids' listings under these words?
    const counts = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'approved' AND network = 'vCommission'
          AND product ILIKE '%dress%' AND product ILIKE '%women%'
          AND product NOT ILIKE '%girl%' AND product NOT ILIKE '%baby%' AND product NOT ILIKE '%kid%')::int
          AS womens_dresses,
        COUNT(*) FILTER (WHERE status = 'approved' AND network = 'vCommission'
          AND product ILIKE '%dress%'
          AND (product ILIKE '%girl%' OR product ILIKE '%baby%' OR product ILIKE '%kid%'))::int
          AS kids_dresses,
        COUNT(*) FILTER (WHERE status = 'approved' AND network = 'vCommission'
          AND product ILIKE '%dress%')::int AS all_dresses
      FROM listings
    `);
    out.counts = counts.rows[0];
    const womensSample = await query(`
      SELECT id, brand, product, category, keywords
      FROM listings
      WHERE status = 'approved' AND network = 'vCommission'
        AND product ILIKE '%dress%' AND product ILIKE '%women%'
        AND product NOT ILIKE '%girl%' AND product NOT ILIKE '%baby%' AND product NOT ILIKE '%kid%'
      ORDER BY id DESC
      LIMIT 8
    `);
    out.womensDressSample = womensSample.rows;
    return Response.json(out);
  }

  const q = params.get("q") || "";
  if (!q) return Response.json({ error: "Pass ?q=<search text> or ?health=1" }, { status: 400 });
  const country = params.get("country") || "IN";

  const queryTerms = extractQueryTerms(q);
  out.queryTerms = queryTerms;

  const candidates = await findCandidateListings(Array.from(new Set(queryTerms)), country);
  out.candidateCount = candidates.length;
  out.candidateSample = candidates.slice(0, 5).map((c) => ({
    id: c.id, brand: c.brand, product: c.product, category: c.category,
    keywords: c.keywords, network: c.network, status: undefined,
    hasLink: Boolean(c.networkLink),
  }));

  const topMatches = findTopMatchingListings(q, candidates, country, 8);
  out.topMatches = topMatches.map((m) => ({
    id: m.listing.id, brand: m.listing.brand, product: m.listing.product,
    network: m.listing.network, score: Number(m.score.toFixed(1)),
    hasLink: Boolean(m.listing.networkLink),
  }));

  return Response.json(out);
}
