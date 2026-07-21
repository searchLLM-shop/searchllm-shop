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

export const maxDuration = 300;

// 300 per run: enough that a large sync clears in a click or two, while
// staying inside the function time limit at ~15 batched API calls.
const BATCH_LIMIT = 300;

async function isAdmin() {
  const user = await currentUser();
  if (!user) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
  return !!email && admins.includes(email);
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


// Lets the admin UI show how many listings still need keywords, so it's clear
// whether another run is needed.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const counts = await countListingsNeedingKeywords();
  return Response.json({
    pending: Number(counts.pending || 0),
    done: Number(counts.done || 0),
  });
}
