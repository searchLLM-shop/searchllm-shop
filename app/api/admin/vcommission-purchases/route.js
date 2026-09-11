// app/api/admin/vcommission-purchases/route.js
//
// Admin-attested vCommission (Shopsy/Myntra) purchase points. vCommission
// periodically sends piBits a report of actual confirmed purchases with
// commission paid — nothing else in the affiliate stack can verify a
// purchase this reliably (see lib/constants.js's LOYALTY comment for why
// automated purchase points were removed entirely back on 2026-08-25). This
// route lets an admin read that report and manually confirm each purchase
// against the matching click here; 25% of the entered commission becomes
// reward points (lib/db.js's creditVcommissionPurchasePoints).
//
// GET  ?limit=&offset=&from=&to=  -> paginated vCommission network_clicks,
//   newest first, optionally date-scoped (how the admin actually works —
//   cross-referencing vCommission's report by date).
// POST { clickId, commission } -> credits that click's purchase.

import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { getVcommissionClicksForAdmin, creditVcommissionPurchasePoints } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdmin";

async function isAdmin() {
  const user = await currentUser();
  return isAdminUser(user);
}

// Resolves Clerk user ids to an email for display, batched in one call per
// page rather than one Clerk API call per row. Guest identities (not real
// Clerk ids) simply won't resolve — those rows fall back to showing the raw
// identity, which is also the "not a registered member" signal for the UI.
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

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;

  const { clicks, total } = await getVcommissionClicksForAdmin({ limit, offset, from, to });
  const emails = await resolveEmails(clicks.map((c) => c.identity));
  const rows = clicks.map((c) => ({ ...c, displayIdentity: emails[c.identity] || c.identity }));

  return Response.json({ clicks: rows, total, limit, offset });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const clickId = String(body.clickId || "").trim();
  const commission = Number(body.commission);
  if (!clickId) return Response.json({ error: "clickId required" }, { status: 400 });
  if (!Number.isFinite(commission) || commission <= 0) {
    return Response.json({ error: "commission must be a positive number" }, { status: 400 });
  }

  const result = await creditVcommissionPurchasePoints({ clickId, commissionInr: commission });
  return Response.json(result);
}
