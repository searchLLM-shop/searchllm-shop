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

  if (params.get("inspect")) {
    // "girl" alone matches 0 rows even restricted to approved+vCommission —
    // surprising given we've directly seen sample product titles containing
    // "Girls". Look at the ACTUAL computed search_tsv for one of those exact
    // rows: does it contain a 'girl' lexeme at all, or is something about
    // how search_tsv is built (or how these specific rows were inserted)
    // different from what schema.sql describes.
    const id = Number(params.get("inspect"));
    const r = await query(
      `SELECT id, product, brand, category, status, network, search_tsv::text AS tsv
       FROM listings WHERE id = $1`,
      [id]
    );
    out.row = r.rows[0] || null;
    return Response.json(out);
  }

  if (params.get("sample")) {
    // 2149 women's dresses vs 2041 kids' dresses in the approved Myntra
    // catalog (confirmed via ?timedquery=1, 2026-09-18) — comparable
    // volume, so the earlier "no women's dress in the top 8" result isn't
    // a catalog gap. This pulls real titles/keywords for a given tsquery
    // so the actual scoring inputs (findTopMatchingListings, lib/
    // listingMatcher.js) can be checked against real data instead of the
    // assumed-kids-heavy sample seen so far.
    const tsq = String(params.get("sample")).replace(/'/g, "''");
    const r = await query(
      `SELECT id, brand, product, keywords, price
       FROM listings
       WHERE status = 'approved' AND network = 'vCommission'
         AND search_tsv @@ to_tsquery('english', '${tsq}')
       ORDER BY id DESC
       LIMIT 8`
    );
    out.tsq = params.get("sample");
    out.sample = r.rows;
    return Response.json(out);
  }

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

  if (params.get("timedquery")) {
    // General-purpose: test ANY tsquery expression's real execution time,
    // safely — every subsequent probe attempt still hit the full 60s
    // Vercel timeout even after fixing concurrency and the statement_
    // timeout leak, so the remaining suspect is that "dress & women" (the
    // only term actually verified fast so far, 2.7s) isn't representative
    // of every compound term this route runs — "dress & (girl|baby|kid)"
    // may itself be weakly selective if the catalog is kids-dress-heavy
    // (exactly what the topMatches results already suggested), hitting
    // the same "huge GIN bitmap before LIMIT can help" cost bare "dress"
    // had. ?timedquery=1&tsq=dress+%26+(girl+%7C+baby+%7C+kid) tests that
    // directly. Defaults to "dress & women" (the one already confirmed
    // fast) when no ?tsq= is given.
    //
    // BEGIN + SET LOCAL (not plain SET) makes the timeout strictly
    // transaction-scoped — it cannot outlive this one query, regardless
    // of success or failure. (Real bug, found 2026-09-17: an earlier
    // version used plain SET with no transaction wrapper and no cleanup
    // — it leaked onto the pooled connection, which lib/db.js's pool
    // only ever has ONE of (max: 1, reused across warm invocations), and
    // capped a LATER, unrelated request's statement_timeout at 8s too.)
    const tsq = params.get("tsq") || "dress & women";
    const startedAt = Date.now();
    try {
      // Real bug (found 2026-09-18): with COMMIT as the trailing statement,
      // r[r.length - 1] was COMMIT's (empty) result, not the SELECT's —
      // every "0 rows" result since the BEGIN/COMMIT wrapper was added is
      // an artifact of THIS bug, not a real finding about the catalog.
      // Fixed by making SELECT the last statement in the batch (so it's
      // unambiguously r[r.length - 1]) and issuing ROLLBACK as a SEPARATE
      // follow-up call — safe for a read-only SELECT either way, and this
      // pool's one connection (max: 1) is what ROLLBACK is protecting,
      // same reasoning as the error path below already had.
      const r = await query(
        `BEGIN;
         SET LOCAL statement_timeout = '8000';
         SELECT id FROM listings
         WHERE status = 'approved' AND network = 'vCommission'
           AND search_tsv @@ to_tsquery('english', '${tsq.replace(/'/g, "''")}')
         LIMIT 5000;`
      );
      const rows = Array.isArray(r) ? r[r.length - 1]?.rows : r.rows;
      out.tsq = tsq;
      out.result = `success, ${rows?.length ?? "?"} rows`;
      try { await query(`ROLLBACK;`); } catch {}
    } catch (err) {
      out.tsq = tsq;
      out.error = String(err?.message || err);
      out.errorCode = err?.code || null;
      // The transaction is aborted on the server after an error — clear it
      // so the (single, reused) connection isn't left mid-transaction for
      // whatever request comes next.
      try { await query(`ROLLBACK;`); } catch {}
    } finally {
      out.elapsedMs = Date.now() - startedAt;
    }
    return Response.json(out);
  }

  if (params.get("probe")) {
    // Does the catalog actually contain approved women's dresses, or is the
    // "women red dress" query being outscored by children's dresses because
    // the catalog itself is skewed toward kids' listings under these words?
    //
    // Every attempt at this via a parameterized query ($1, extended
    // protocol) either hit the full 60s Vercel timeout or (once concurrency
    // and a leaked statement_timeout were both fixed) still never came
    // back. ?timedquery=1 proved the SAME logical query, sent as a raw
    // interpolated string (simple protocol, no bind params), runs in
    // 2-4 seconds for both "dress & women" and "dress & (girl|baby|kid)" —
    // so the query and the data were never the problem, something about
    // the parameterized/extended-protocol form specifically was. Reusing
    // the proven-working shape here rather than chasing that further.
    const cappedCount = async (tsq) => {
      const r = await query(
        `SELECT id FROM listings
         WHERE status = 'approved' AND network = 'vCommission'
           AND search_tsv @@ to_tsquery('english', '${tsq.replace(/'/g, "''")}')
         LIMIT 5000`
      );
      return r.rows.length;
    };
    const womensCount = await cappedCount("dress & women");
    const kidsCount = await cappedCount("dress & (girl | baby | kid)");
    out.counts = {
      womens_dresses: womensCount,
      kids_dresses: kidsCount,
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
