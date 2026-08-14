// app/api/admin/redemptions/route.js
//
// The voucher-fulfilment queue. Manual by default: an admin buys the
// voucher and pastes the code, which becomes visible to the member on
// their Rewards tab. An "auto" action attempts automated issuance via
// Pine Labs/Qwikcilver first (lib/vouchers/qwikcilver.js) — a documented
// stub until real credentials/spec exist, so it currently declines every
// attempt with a reason rather than guessing, and the manual path below
// stays the fallback for as long as that's true.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getRedemptionQueue, resolveRedemption } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";
import { issueVoucher, isConfigured as isVoucherApiConfigured } from "@/lib/vouchers/qwikcilver";

export const maxDuration = 15;

async function isAdmin() {
  const user = await currentUser();
  return isAdminEmail(user?.emailAddresses?.[0]?.emailAddress);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({
    queue: await getRedemptionQueue(),
    autoIssuanceConfigured: isVoucherApiConfigured(),
  });
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
  if (body.action === "auto") {
    // voucherType/points come from the queue row the admin is already
    // looking at, not re-fetched — resolveRedemption below still checks
    // status = 'requested' so a stale/double-click can't double-issue.
    const voucherType = String(body.voucherType || "").trim();
    const points = Number(body.points);
    if (!voucherType || !Number.isInteger(points)) {
      return Response.json({ ok: false, reason: "Missing voucherType/points" }, { status: 400 });
    }
    const result = await issueVoucher({ brand: voucherType, denomination: points, redemptionId: id });
    if (!result.ok) return Response.json({ ok: false, reason: result.reason });
    const fulfilled = await resolveRedemption(id, "fulfill", result.voucherCode);
    if (!fulfilled) return Response.json({ ok: false, reason: "Issued a voucher but the redemption was already resolved — check for a duplicate code." });
    return Response.json({ ok: true, voucherCode: result.voucherCode, automatic: true });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
