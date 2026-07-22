// app/api/admin/conversions/route.js
//
// Polls the affiliate networks' transaction reports and matches sales back
// to outbound clicks (see lib/conversions.js). Triggered two ways, same
// pattern as /api/admin/sync:
//   1. Vercel Cron via GET with "Authorization: Bearer <CRON_SECRET>" —
//      daily; conversions settle over days and weeks, not minutes.
//   2. An admin in the dashboard: POST runs a poll now; GET returns the
//      latest run status; GET ?diag=1 fetches a LIVE sample from each
//      network and reports its actual field shape WITHOUT writing anything.
//      Run diag before trusting the vCommission mapping (rule #4 — the p1
//      echo field is unverified until seen in a real conversion).

import { auth, currentUser } from "@clerk/nextjs/server";
import { pollConversions, diagConversions, fetchVcommissionPerformanceReport } from "@/lib/conversions";
import { getLatestSyncRuns } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

export const maxDuration = 300;

async function isAdmin() {
  const user = await currentUser();
  return isAdminEmail(user?.emailAddresses?.[0]?.emailAddress);
}

function isCronAuthorized(req) {
  const authHeader = req.headers.get("authorization");
  return process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req) {
  if (isCronAuthorized(req)) {
    const results = await pollConversions();
    return Response.json({ results });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  if (params.get("diag") === "1") {
    return Response.json({ diag: await diagConversions() });
  }

  // ?report=1 — the documented AGGREGATE vCommission performance report
  // (campaign-level clicks/conversions/payout). Real revenue numbers,
  // available before per-click matching works; read-only, nothing stored.
  if (params.get("report") === "1") {
    try {
      const days = Math.min(Number(params.get("days")) || 30, 90);
      return Response.json(await fetchVcommissionPerformanceReport({ lookbackDays: days }));
    } catch (err) {
      return Response.json({ error: String(err?.message || err) }, { status: 502 });
    }
  }

  // Default admin read: latest run per network (the conversion polls log
  // under their own distinct names, so they show alongside the feed syncs).
  const latest = await getLatestSyncRuns();
  return Response.json({ latest });
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const results = await pollConversions();
    return Response.json({ results });
  } catch (err) {
    console.error("pollConversions threw:", err);
    return Response.json({ error: "Poll failed", detail: String(err?.message || err) }, { status: 500 });
  }
}
