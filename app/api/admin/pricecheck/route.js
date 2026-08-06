// app/api/admin/pricecheck/route.js
//
// Runs shortly after the hourly feed sync (see vercel.json — sync fires at
// minute 0, this fires at minute 15, giving sync time to finish writing
// fresh listings.price values first). Compares every actively-watched
// listing's current price against what each watcher last saw, and records
// / sends a notification for genuine drops. See lib/priceAlerts.js for the
// actual logic; this route is just the same two-way auth wrapper every
// other cron-backed admin route in this app uses (Vercel Cron via GET +
// CRON_SECRET, or an admin manually triggering it via POST).

import { auth, currentUser } from "@clerk/nextjs/server";
import { processPriceDrops } from "@/lib/priceAlerts";

export const maxDuration = 60;

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

export async function GET(req) {
  if (!isCronAuthorized(req)) return new Response("Forbidden", { status: 403 });
  try {
    const result = await processPriceDrops();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Price check cron failed:", err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// Admin dashboard "check now" button — same underlying work, session-gated.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const result = await processPriceDrops();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Price check (manual) failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
