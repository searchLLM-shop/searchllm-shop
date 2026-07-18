// app/api/admin/enrich-keywords/route.js
//
// Admin action: regenerate search keywords for listings using the model.
// Feed/campaign titles produce poor keywords on their own (a vCommission
// offer titled "Trunativ.co Ecommerce CPS - India" would only ever match the
// words "trunativ", "ecommerce" or "india"), so a listing that genuinely
// sells whey protein could never match someone searching for whey protein.
// This rewrites those keywords into what shoppers actually type.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getListingsNeedingKeywords, updateListingKeywords } from "@/lib/db";
import { generateKeywords } from "@/lib/keywordEnricher";

export const maxDuration = 300;

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
    const listings = await getListingsNeedingKeywords(100);
    if (!listings.length) {
      return Response.json({ updated: 0, message: "No listings to enrich." });
    }

    const { results, errors } = await generateKeywords(listings);

    let updated = 0;
    for (const listing of listings) {
      const kws = results.get(String(listing.id));
      if (!kws || !kws.length) continue;
      // Keep the category as a keyword so category-level matching still works.
      const merged = Array.from(new Set([...kws, listing.category].filter(Boolean)));
      await updateListingKeywords(listing.id, merged);
      updated += 1;
    }

    return Response.json({
      updated,
      considered: listings.length,
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
