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

export const maxDuration = 60;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const out = {};

  // Both modes below use search_tsv @@ to_tsquery(...) to narrow FIRST — it
  // hits the existing GIN index (idx_listings_search_tsv). A bare ILIKE
  // '%dress%' over 3.4M+ rows with no index support is a full sequential
  // scan and timed out past this route's maxDuration on first try
  // (2026-09-17) — the fix is narrowing via the index before doing any
  // per-row regex work, not just raising the timeout.
  if (params.get("health")) {
    const byNetworkStatus = await query(`
      SELECT network, status, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE network_link IS NULL OR network_link = '')::int AS no_link
      FROM listings
      WHERE status = 'approved'
      GROUP BY network, status
      ORDER BY n DESC
      LIMIT 30
    `);
    out.byNetworkStatus = byNetworkStatus.rows;

    const myntraSample = await query(`
      SELECT id, brand, product, category, keywords, status,
             (network_link IS NOT NULL AND network_link <> '') AS "hasLink"
      FROM listings
      WHERE network = 'vCommission' AND status = 'approved'
        AND search_tsv @@ to_tsquery('english', 'dress')
      ORDER BY id DESC
      LIMIT 8
    `);
    out.myntraDressSample = myntraSample.rows;
    return Response.json(out);
  }

  if (params.get("explain")) {
    // The probe still hit the full 60s Vercel Runtime Timeout even after
    // compound-tsquery + LIMIT 5000 (confirmed via `vercel logs` — a real
    // Postgres-side timeout, not a client artifact). That's suspicious for
    // an indexed, capped query, so check the two likeliest causes directly
    // instead of guessing further: (1) table statistics never refreshed
    // after the 3.4M-row bulk import, so the planner may be choosing a
    // sequential scan over the GIN index; (2) whether the index is even
    // being considered at all. EXPLAIN alone (no ANALYZE) just asks the
    // planner for its chosen plan — it does not execute the query, so this
    // returns instantly regardless of how slow the real query is.
    const stats = await query(`
      SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze,
             last_vacuum, last_autovacuum
      FROM pg_stat_user_tables
      WHERE relname = 'listings'
    `);
    out.tableStats = stats.rows[0] || null;

    const plan = await query(`
      EXPLAIN (FORMAT JSON)
      SELECT 1 FROM listings
      WHERE status = 'approved' AND network = 'vCommission'
        AND search_tsv @@ to_tsquery('english', 'dress & women')
      LIMIT 5000
    `);
    out.queryPlan = plan.rows[0]["QUERY PLAN"];

    const idx = await query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'listings'
    `);
    out.indexes = idx.rows;

    return Response.json(out);
  }

  if (params.get("probe")) {
    // Does the catalog actually contain approved women's dresses, or is the
    // "women red dress" query being outscored by children's dresses because
    // the catalog itself is skewed toward kids' listings under these words?
    //
    // The previous version (2026-09-17) still timed out even through the
    // tsv index: `dress` alone matches a huge share of a clothing-heavy
    // 3.4M-row catalog, so the CTE still had to materialize and then
    // ILIKE-scan a massive intermediate set before COUNT(*) could finish.
    // Fixed two ways: (1) compound tsqueries (`dress & women`, letting GIN
    // intersect both terms instead of filtering the smaller set in a
    // second pass), (2) every count is capped at 5000 via a LIMIT
    // subquery — plenty to answer "does this exist in real numbers", far
    // cheaper than an exact count over however many hundreds of thousands
    // of rows actually match.
    const cappedCount = (label, tsq) => query(
      `SELECT '${label}' AS label, COUNT(*)::int AS n FROM (
         SELECT 1 FROM listings
         WHERE status = 'approved' AND network = 'vCommission'
           AND search_tsv @@ to_tsquery('english', $1)
         LIMIT 5000
       ) t`,
      [tsq]
    );
    const [womens, kids, allDress] = await Promise.all([
      cappedCount("womens_dresses", "dress & women"),
      cappedCount("kids_dresses", "dress & (girl | baby | kid)"),
      cappedCount("all_dresses", "dress"),
    ]);
    out.counts = {
      womens_dresses: womens.rows[0].n,
      kids_dresses: kids.rows[0].n,
      all_dresses: allDress.rows[0].n,
      note: "each capped at 5000 — a count of 5000 means 'at least 5000', not exact",
    };
    const womensSample = await query(`
      SELECT id, brand, product, category, keywords
      FROM listings
      WHERE status = 'approved' AND network = 'vCommission'
        AND search_tsv @@ to_tsquery('english', 'dress & women')
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
