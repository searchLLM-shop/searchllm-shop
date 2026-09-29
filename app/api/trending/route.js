// app/api/trending/route.js
//
// Public "trending now" categories for the homepage strip. Reads the
// same anonymous search_queries table the admin queries panel already
// uses (lib/db.js's getPublicTrendingCategories) — no identity ever
// attached to a row, this is aggregate demand only, not per-user
// history. Deliberately matched=true only: a "trending" pill that leads
// to "not in our partner inventory" is a worse experience than not
// showing it — the unmatched/gap side is a separate, admin-only signal
// (see /api/admin/queries).
//
// No auth — this is meant to be publicly cacheable.

import { getPublicTrendingCategories } from "@/lib/db";

export async function GET() {
  try {
    const categories = await getPublicTrendingCategories(7, 8);
    return Response.json(
      { categories },
      { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=1800" } }
    );
  } catch (err) {
    console.error("Trending fetch failed:", err.message);
    return Response.json({ categories: [] });
  }
}
