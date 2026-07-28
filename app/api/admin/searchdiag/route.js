// app/api/admin/searchdiag/route.js
//
// Verifies a search adapter against a REAL response before it's trusted in
// production — the standing rule that no integration ships against an
// assumed API shape. Shows what the provider returned and what our adapter
// managed to parse out of it, side by side.
//
//   /api/admin/searchdiag?provider=serper&q=best+tv+under+30000
//
// If `parsed` is empty while `raw` clearly contains results, the adapter's
// field names are wrong — fix them against the raw output shown here.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminEmail } from "@/lib/isAdmin";
import { webSearchDiag, searchProvider } from "@/lib/search";

export const maxDuration = 30;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const q = params.get("q") || "best tv under 30000";
  const provider = params.get("provider") || searchProvider();
  const count = Math.min(Number(params.get("count")) || 4, 10);

  const result = await webSearchDiag(q, provider, count, params.get("country") || "IN");
  return Response.json({
    activeProvider: searchProvider(),
    testedProvider: provider,
    query: q,
    parsedCount: result.parsed?.length ?? 0,
    ...result,
  });
}
