// app/api/admin/referrals/route.js
//
// Read-only admin report on the referral programme — total referrals,
// total points given out, and a leaderboard of top referrers. Same
// auth boilerplate as every other admin route.

import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getReferralsReport } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdmin";

async function isAdmin() {
  const user = await currentUser();
  return isAdminUser(user);
}

// Same pattern as app/api/admin/vcommission-purchases/route.js — resolve
// Clerk ids to an email for admin readability, one batched call.
async function resolveEmails(identities) {
  const ids = Array.from(new Set(identities.filter(Boolean)));
  if (!ids.length) return {};
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: ids, limit: ids.length });
    const map = {};
    for (const u of data) {
      map[u.id] = u.emailAddresses?.[0]?.emailAddress || u.phoneNumbers?.[0]?.phoneNumber || u.id;
    }
    return map;
  } catch (err) {
    console.error("Clerk user lookup failed (non-fatal, falling back to raw identity):", err.message);
    return {};
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const report = await getReferralsReport();
    const emails = await resolveEmails(report.topReferrers.map((r) => r.referrerUserId));
    const topReferrers = report.topReferrers.map((r) => ({ ...r, displayIdentity: emails[r.referrerUserId] || r.referrerUserId }));
    return Response.json({ ...report, topReferrers });
  } catch (err) {
    console.error("Referrals report failed:", err);
    return Response.json({ error: "Could not load referrals report" }, { status: 500 });
  }
}
