// app/api/admin/enrich-keywords/route.js
//
// Admin action: regenerate search keywords for listings using the model.
// Feed/campaign titles produce poor keywords on their own (a vCommission
// offer titled "Trunativ.co Ecommerce CPS - India" would only ever match the
// words "trunativ", "ecommerce" or "india"), so a listing that genuinely
// sells whey protein could never match someone searching for whey protein.
// This rewrites those keywords into what shoppers actually type.

import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getListingsNeedingKeywords, updateListingKeywords,
  countListingsNeedingKeywords, markKeywordsAttempted,
} from "@/lib/db";
import { generateKeywords } from "@/lib/keywordEnricher";
import { ENABLE_AI_KEYWORDS } from "@/lib/constants";
import { isAdminUser } from "@/lib/isAdmin";

export const maxDuration = 300;

// 300 per run: enough that a large sync clears in a click or two, while
// staying inside the function time limit at ~15 batched API calls.
const BATCH_LIMIT = 120;

async function isAdmin() {
  const user = await currentUser();
  return isAdminUser(user);
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const before = await countListingsNeedingKeywords();
    const listings = await getListingsNeedingKeywords(BATCH_LIMIT);

    if (!listings.length) {
      return Response.json({
        updated: 0,
        remaining: 0,
        message: "All listings have been processed.",
      });
    }

    const { results, errors } = await generateKeywords(listings);

    let updated = 0;
    const attempted = [];
    for (const listing of listings) {
      attempted.push(listing.id);
      const kws = results.get(String(listing.id));
      if (!kws || !kws.length) continue;
      // Keep the category so category-level matching still works.
      const merged = Array.from(new Set([...kws, listing.category].filter(Boolean)));
      await updateListingKeywords(listing.id, merged);
      updated += 1;
    }

    // Mark everything we looked at — including listings the model couldn't
    // improve — so the next run moves forward instead of retrying them.
    const improvedIds = new Set(
      listings.filter((l) => results.get(String(l.id))?.length).map((l) => l.id)
    );
    await markKeywordsAttempted(attempted.filter((id) => !improvedIds.has(id)));

    const after = await countListingsNeedingKeywords();

    return Response.json({
      updated,
      considered: listings.length,
      remaining: Number(after.pending || 0),
      totalProcessed: Number(after.done || 0),
      message:
        Number(after.pending || 0) > 0
          ? `Updated ${updated} of ${listings.length}. ${after.pending} listings still to go — run again.`
          : `Updated ${updated} of ${listings.length}. All listings are now processed.`,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("Keyword enrichment failed:", err);
    return Response.json(
      { error: "Keyword enrichment failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}


// Cron entry point. Vercel Cron issues GET with the project's CRON_SECRET, so
// this can chew through the backlog unattended — a browser loop was never the
// right place for an hour of work, and any fetch timeout or closed tab killed
// it. Runs batches until it approaches the function time limit, then stops
// cleanly and picks up on the next scheduled run.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  // Guard on CRON_SECRET being set FIRST — without it, an unset env var
  // would make this `authHeader === "Bearer undefined"`, letting anyone
  // who sends that literal header in as "cron" (matches the safer pattern
  // already used in admin/sync and admin/pricecheck).
  const isCron = Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // AI enrichment is paused (see ENABLE_AI_KEYWORDS in constants.js) —
  // matching runs on mechanical keywords + full-text search instead. The
  // cron entry has been removed from vercel.json too; this guard is here in
  // case one ever comes back. The manual admin POST above stays functional
  // for deliberate, bounded runs.
  // ONE-TIME BACKFILL OVERRIDE (2026-07-23): ENRICH_BACKFILL=1 in the env
  // lets the cron run the full-corpus Haiku pass despite the strategy flag
  // — enrichment as ONGOING policy stays off; this is a bounded catch-up to
  // level the enriched-vs-bare keyword asymmetry that was tilting ranking.
  // Delete the env var (and the vercel.json cron line) when remaining hits
  // zero; the cron also no-ops harmlessly at that point.
  const backfill = process.env.ENRICH_BACKFILL === "1";
  if (isCron && !ENABLE_AI_KEYWORDS && !backfill) {
    return Response.json({
      skipped: "AI keyword enrichment is disabled (ENABLE_AI_KEYWORDS=false); matching uses mechanical keywords + full-text search.",
    });
  }

  if (!isCron) {
    // Not cron — treat as the admin UI asking for a progress count.
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
    if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
    const counts = await countListingsNeedingKeywords();
    return Response.json({ pending: Number(counts.pending || 0), done: Number(counts.done || 0) });
  }

  const startedAt = Date.now();
  const TIME_BUDGET_MS = 240000; // stop well before the 300s ceiling
  let processed = 0;
  let batches = 0;

  try {
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const listings = await getListingsNeedingKeywords(BATCH_LIMIT);
      if (!listings.length) break;

      let results;
      try {
        ({ results } = await generateKeywords(listings));
      } catch (err) {
        // Rate limits are expected on a fresh console tier: back off and
        // keep going rather than dying — the time budget still bounds us.
        if (String(err?.message || err).includes("429")) {
          await new Promise((r) => setTimeout(r, 20000));
          continue;
        }
        throw err;
      }
      const improved = [];
      for (const listing of listings) {
        const kws = results.get(String(listing.id));
        if (!kws || !kws.length) continue;
        const merged = Array.from(new Set([...kws, listing.category].filter(Boolean)));
        await updateListingKeywords(listing.id, merged);
        improved.push(listing.id);
      }
      // Mark the rest attempted so the backlog always moves forward.
      await markKeywordsAttempted(
        listings.map((l) => l.id).filter((id) => !improved.includes(id))
      );

      processed += listings.length;
      batches += 1;
    }

    const counts = await countListingsNeedingKeywords();
    return Response.json({
      ok: true,
      processed,
      batches,
      remaining: Number(counts.pending || 0),
      seconds: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch (err) {
    console.error("Cron keyword enrichment failed:", err);
    return Response.json(
      { ok: false, processed, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
