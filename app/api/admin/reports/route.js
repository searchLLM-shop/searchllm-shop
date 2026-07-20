// app/api/admin/reports/route.js
//
// Aggregated reporting for the admin panel. Admin-gated: these are business
// metrics, not something to expose publicly.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getReportSummary } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

export const maxDuration = 60;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const days = Math.min(Number(new URL(req.url).searchParams.get("days")) || 30, 90);

  try {
    const report = await getReportSummary(days);
    return Response.json(report);
  } catch (err) {
    console.error("Reports failed:", err);
    return Response.json(
      { error: "Could not build report", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
