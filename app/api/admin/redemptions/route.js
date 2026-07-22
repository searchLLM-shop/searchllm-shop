// app/api/admin/redemptions/route.js
//
// The manual voucher-fulfilment queue. Deliberately manual at this stage:
// an admin buys the voucher and pastes the code, which becomes visible to
// the member on their Rewards tab. Voucher-API integrations are a problem
// worth having only once the programme demonstrably works.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getRedemptionQueue, resolveRedemption } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

export const maxDuration = 15;

async function isAdmin() {
  const user = await currentUser();
  return isAdminEmail(user?.emailAddresses?.[0]?.emailAddress);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ queue: await getRedemptionQueue() });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "Bad id" }, { status: 400 });

  if (body.action === "fulfill") {
    const code = String(body.voucherCode || "").trim();
    if (!code) return Response.json({ error: "Voucher code required" }, { status: 400 });
    const ok = await resolveRedemption(id, "fulfill", code);
    return Response.json({ ok });
  }
  if (body.action === "reject") {
    const ok = await resolveRedemption(id, "reject");
    return Response.json({ ok });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
