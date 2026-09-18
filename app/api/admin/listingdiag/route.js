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
import { mentionsMinors } from "@/lib/contentFilter";

export const maxDuration = 60;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const out = {};

  if (params.get("explainCandidates")) {
    // findCandidateListings itself started 504-ing right after the bulk
    // approve (2026-09-18) grew the approved pool 22x (169K -> 3.8M) —
    // check whether its query plan has genuinely gotten more expensive at
    // this new scale, via EXPLAIN alone (no execution, so this call can't
    // itself time out regardless of how slow the real query has become).
    // Mirrors findCandidateListings' exact SQL shape (lib/db.js) — same
    // WHERE clause, same ORDER BY ts_rank, so the plan shown here is
    // exactly what that function is actually choosing right now.
    const qtext = String(params.get("explainCandidates"));
    const terms = extractQueryTerms(qtext);
    // Mirrors findCandidateListings' quorum logic (lib/db.js, 2026-09-18)
    // exactly — this diagnostic's own ftsQuery construction needs to
    // match the real function's, not just its WHERE/ORDER BY shape, or
    // the plan shown here is for a query the real code doesn't actually
    // run anymore. (Two earlier versions of this mirror got the pool
    // wrong — see the long comment on findCandidateListings for the full
    // story of why a length-based cap, and then a pool drawn from the
    // already-expanded terms array, both failed.)
    const cleanTerms = terms
      .filter((t) => !t.includes(" "))
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 3);
    let ftsQuery;
    if (cleanTerms.length <= 8) {
      ftsQuery = cleanTerms.join(" | ");
    } else {
      const plainWords = qtext
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
      const pool = plainWords.length >= 2
        ? Array.from(new Set(plainWords)).sort((a, b) => b.length - a.length).slice(0, 8)
        : Array.from(new Set(cleanTerms)).sort((a, b) => b.length - a.length).slice(0, 8);
      const pairs = [];
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) pairs.push(`(${pool[i]} & ${pool[j]})`);
      }
      ftsQuery = pairs.join(" | ");
    }
    out.terms = terms;
    out.ftsQuery = ftsQuery;
    const plan = await query(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM listings
       WHERE status = 'approved'
         AND (keywords && $1::text[]
              OR ($2 <> '' AND search_tsv @@ to_tsquery('english', $2)))
       ORDER BY (CASE WHEN $2 <> '' THEN ts_rank(search_tsv, to_tsquery('english', $2)) ELSE 0 END) DESC,
                rating_count DESC NULLS LAST, id DESC
       LIMIT 200`,
      [terms, ftsQuery]
    );
    out.queryPlan = plan.rows[0]["QUERY PLAN"];
    return Response.json(out);
  }

  if (params.get("analyze")) {
    // ~2.18M rows just flipped from 'pending' to 'approved' in one bulk
    // operation (2026-09-18, approving the long-pending Myntra import) —
    // the planner's statistics on `listings` are now badly stale relative
    // to that, and feedStatus's own simple GROUP BY started timing out
    // immediately afterward as a direct result. ANALYZE just refreshes
    // planner statistics via sampling — it doesn't rewrite any data, and
    // takes only a brief, non-blocking lock, safe to run against a live
    // table.
    const startedAt = Date.now();
    await query(`ANALYZE listings`);
    out.analyzed = true;
    out.elapsedMs = Date.now() - startedAt;
    return Response.json(out);
  }

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

  if (params.get("nonaccessory")) {
    // "iphone 15" returned nothing but cases/cables/covers in topMatches
    // (2026-09-18) — before treating this as a scoring bug (same shape as
    // the dress fix), check the more basic question first, same discipline
    // as the earlier catalog-gap check: does this catalog carry ANY
    // non-accessory "iphone 15" listing at all, or is this a genuine
    // inventory gap (no actual phones in this feed, only accessories for
    // them) rather than something scoring can fix. tsv-narrows first (the
    // proven-fast pattern), THEN excludes common accessory words on that
    // already-small set.
    const tsq = String(params.get("nonaccessory")).replace(/'/g, "''");
    const r = await query(
      `SELECT id, brand, product, price FROM listings
       WHERE status = 'approved' AND network = 'vCommission'
         AND search_tsv @@ to_tsquery('english', '${tsq}')
         AND product !~* '\\y(cover|case|cable|charger|screen|protector|tempered|glass|skin|pouch|holder|stand|strap|adapter|sticker)\\y'
       LIMIT 10`
    );
    out.tsq = params.get("nonaccessory");
    out.nonAccessoryMatches = r.rows;
    return Response.json(out);
  }

  if (params.get("feedStatus")) {
    // scripts/import-vcommission-myntra.mjs hardcodes status='pending',
    // source='feed' on every insert — bulk approval was always meant to
    // be a SEPARATE step. myntraSample's zero result (2026-09-18) means
    // either that step never ran, never persisted, or something else is
    // going on — check the real current state of the 'feed'-sourced
    // vCommission rows directly instead of guessing. idx_listings_source
    // is a real btree index, so this is filtered, not a bare table scan.
    const byStatus = await query(
      `SELECT status, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE merchant_domain = 'myntra.com')::int AS myntra_domain_n
       FROM listings
       WHERE network = 'vCommission' AND source = 'feed'
       GROUP BY status
       ORDER BY n DESC`
    );
    out.byStatus = byStatus.rows;
    return Response.json(out);
  }

  if (params.get("myntraSample")) {
    // Every fashion match this session has actually resolved to
    // merchant_domain "shopsy.in" (a different vCommission campaign, not
    // Myntra) — the user explicitly wants to SEE a real myntra.com link, so
    // check what real Myntra-hosted listings actually look like before
    // recommending a query, rather than assuming the fashion queries
    // already tested land on Myntra specifically.
    const r = await query(
      `SELECT id, brand, product, keywords, price, merchant_domain AS "merchantDomain"
       FROM listings
       WHERE status = 'approved' AND network = 'vCommission'
         AND merchant_domain = 'myntra.com'
       LIMIT 10`
    );
    out.myntraCount = r.rows.length;
    out.myntraSample = r.rows;
    const domainCounts = await query(
      `SELECT merchant_domain AS "merchantDomain", COUNT(*)::int AS n
       FROM listings
       WHERE status = 'approved' AND network = 'vCommission'
       GROUP BY merchant_domain
       ORDER BY n DESC
       LIMIT 10`
    );
    out.domainCounts = domainCounts.rows;
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
    // No ORDER BY id DESC (real bug, found 2026-09-18): sorting by a plain
    // btree-indexed column unrelated to the filter can push Postgres into
    // scanning that index in sort order, filtering row by row, instead of
    // building the bitmap from idx_listings_search_tsv first — fine when
    // matches are dense near the high end of `id`, a very long scan when
    // they aren't. The bare LIMIT-only version (no ORDER BY) already
    // proven fast via ?timedquery=1 doesn't have this failure mode; row
    // order doesn't matter for this diagnostic anyway. (Real production
    // code doesn't hit this: findCandidateListings orders by ts_rank
    // first, a computed expression with no matching index, which forces a
    // Sort node AFTER the bitmap scan rather than tempting the planner
    // into scanning an index in output order.)
    const tsq = String(params.get("sample")).replace(/'/g, "''");
    const r = await query(
      `SELECT id, brand, product, keywords, price
       FROM listings
       WHERE status = 'approved' AND network = 'vCommission'
         AND search_tsv @@ to_tsquery('english', '${tsq}')
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

  // Mirrors app/api/research/route.js's own excludeMinors computation
  // exactly, so this diagnostic reflects real production behavior.
  const excludeMinors = !mentionsMinors(q);
  out.excludeMinors = excludeMinors;
  const candidates = await findCandidateListings(Array.from(new Set(queryTerms)), country, 200, excludeMinors, q);
  out.candidateCount = candidates.length;
  out.candidateSample = candidates.slice(0, 5).map((c) => ({
    id: c.id, brand: c.brand, product: c.product, category: c.category,
    keywords: c.keywords, network: c.network, price: c.price, status: undefined,
    hasLink: Boolean(c.networkLink),
  }));

  // ?productType=<...> lets this diagnostic exercise the productType boost
  // (added 2026-09-18 to lib/listingMatcher.js) without paying for a live
  // extractIntent() call — the real research route always passes
  // intent?.productType through automatically.
  const productType = params.get("productType") || null;
  out.productType = productType;
  const topMatches = findTopMatchingListings(q, candidates, country, 8, productType);
  out.topMatches = topMatches.map((m) => ({
    id: m.listing.id, brand: m.listing.brand, product: m.listing.product,
    network: m.listing.network, price: m.listing.price, score: Number(m.score.toFixed(1)),
    hasLink: Boolean(m.listing.networkLink),
  }));

  return Response.json(out);
}
