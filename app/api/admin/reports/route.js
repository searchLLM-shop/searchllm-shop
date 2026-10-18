// app/api/admin/reports/route.js
//
// Aggregated reporting for the admin panel. Admin-gated: these are business
// metrics, not something to expose publicly.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getReportSummary } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdmin";

// 120s: the report runs ~16 queries, some of them scans of a multi-million-row
// table; the handler itself answers (with JSON) at 100s at the latest.
export const maxDuration = 120;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const user = await currentUser();
  if (!isAdminUser(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const days = Math.min(Number(params.get("days")) || 30, 90);
  // Optional custom range: ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides the
  // preset. Validation and span-capping happen in normalizeRange.
  const range = params.get("from") && params.get("to")
    ? { from: params.get("from"), to: params.get("to") }
    : null;

  try {
    // Always answer with JSON before the platform's own limit: past
    // maxDuration Vercel replaces the response with a plain-text error page,
    // which the panel then reports as "Unexpected token 'A' ... is not valid
    // JSON" instead of anything useful.
    const report = await Promise.race([
      getReportSummary(days, range),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Reports took longer than 100 seconds to calculate. Try a shorter date range, or reload in a minute.")), 100000)
      ),
    ]);
    return Response.json(report);
  } catch (err) {
    console.error("Reports failed:", err);
    return Response.json(
      { error: "Could not build report", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
