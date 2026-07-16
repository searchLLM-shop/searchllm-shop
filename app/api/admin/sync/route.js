// app/api/admin/sync/route.js
//
// Two ways to trigger a sync:
//   1. Vercel Cron calling this on a schedule via GET (Vercel Cron jobs
//      always issue GET requests, and automatically send the project's
//      CRON_SECRET environment variable as "Authorization: Bearer
//      <CRON_SECRET>" — verified against Vercel's own docs, not a custom
//      header scheme). See vercel.json for the schedule.
//   2. An admin clicking "Sync now" in the dashboard (POST, session-
//      authenticated via the same ADMIN_EMAILS check as other admin routes).

import { auth, currentUser } from "@clerk/nextjs/server";
import { runFullSync } from "@/lib/feeds/sync";
import { getLatestSyncRuns } from "@/lib/db";

// Pulling hundreds of products across multiple feed downloads can exceed
// the default serverless timeout (often 10s), which makes Vercel return
// an HTML error page. Ask for more time. (On Hobby the ceiling is 60s;
// on Pro it's higher — this project's team is Pro.)
export const maxDuration = 300;

async function isAdmin() {
  const user = await currentUser();
  if (!user) return false;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const userEmail = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
  return adminEmails.includes(userEmail);
}

function isCronAuthorized(req) {
  const authHeader = req.headers.get("authorization");
  return process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// Vercel Cron invokes this via GET. This is also reused below for the
// admin dashboard's "view sync status" read, gated by session instead.
export async function GET(req) {
  if (isCronAuthorized(req)) {
    const results = await runFullSync();
    return Response.json({ results });
  }

  // Not a cron request — fall back to admin-session-gated status read.
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const latest = await getLatestSyncRuns();
  return Response.json({ latest });
}

// Manual "Sync now" button in the admin dashboard — POST, session-gated.
export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const results = await runFullSync();
  return Response.json({ results });
}
