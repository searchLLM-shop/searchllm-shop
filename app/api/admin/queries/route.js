// app/api/admin/queries/route.js
//
// What shoppers are searching for. The queries are stored ANONYMOUSLY — no
// identity ever accompanies the text (see the search_queries DDL) — so this
// is aggregate market demand, not user history. The topUnmatched list is
// the actionable output: the feeds to request from the networks next.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getSearchQueryStats, getRecentSearchQueries } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

export const maxDuration = 30;
const PAGE_SIZE = 50;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days")) || 30, 90);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  try {
    const range = url.searchParams.get("from") && url.searchParams.get("to")
      ? { from: url.searchParams.get("from"), to: url.searchParams.get("to") }
      : null;
    const [stats, recent] = await Promise.all([
      getSearchQueryStats(days, range),
      getRecentSearchQueries(days, page, PAGE_SIZE, range),
    ]);
    return Response.json({ ...stats, recent, page, pageSize: PAGE_SIZE });
  } catch (err) {
    console.error("Query stats failed:", err);
    return Response.json({ error: "Could not load queries", detail: String(err?.message || err) }, { status: 500 });
  }
}
