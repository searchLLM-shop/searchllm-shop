// app/api/admin/config/route.js
//
// Reports which environment variables the RUNNING code can actually see.
// Vercel hides the value of any variable marked "Sensitive", so the dashboard
// showing a blank field proves nothing either way. This settles it by asking
// the deployment itself.
//
// Values are never returned — only whether something is set, its length, and
// a short shape hint. Enough to spot a missing, truncated or malformed value
// without exposing a single secret.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminEmail } from "@/lib/isAdmin";

const VARS = [
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "ADMIN_EMAILS",
  "CRON_SECRET",
  "BRAVE_API_KEY",
  "AWIN_DATAFEED_API_KEY",
  "IMPACT_ACCOUNT_SID",
  "IMPACT_AUTH_TOKEN",
  "VCOMMISSION_API_KEY",
  "VCOMMISSION_PRODUCT_FEED_URLS",
  "MIN_PRODUCT_PRICE",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = {};
  for (const name of VARS) {
    const raw = process.env[name];
    if (raw == null || raw === "") {
      report[name] = { set: false };
      continue;
    }
    const entry = { set: true, length: raw.length };
    // Flag the paste mistakes that actually happen, without echoing anything.
    if (raw !== raw.trim()) entry.warning = "has leading/trailing whitespace";
    if (/^["']|["']$/.test(raw)) entry.warning = "wrapped in quotes — remove them";
    report[name] = entry;
  }

  // The feed URL list gets extra scrutiny, since a malformed one fails silently.
  const feeds = (process.env.VCOMMISSION_PRODUCT_FEED_URLS || "")
    .split(",").map((u) => u.trim()).filter(Boolean);
  report._feedUrlCheck = {
    urlCount: feeds.length,
    allValid: feeds.every((u) => { try { new URL(u); return true; } catch { return false; } }),
    hosts: Array.from(new Set(feeds.map((u) => { try { return new URL(u).hostname; } catch { return "INVALID"; } }))),
    // Filenames only — these are public storage paths, not secrets.
    files: feeds.map((u) => { try { return new URL(u).pathname.split("/").pop(); } catch { return "INVALID"; } }),
  };

  return Response.json(report);
}
