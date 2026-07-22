// app/api/rewards/route.js
//
// The member-facing rewards API. Accounts only — points need a durable
// identity, and guest cookies rotate — and strictly opt-in: joining is an
// explicit consent action (see the join screen and Privacy Policy section),
// because membership links purchases made through our links to the account,
// which the rest of the site deliberately never does.

import { auth } from "@clerk/nextjs/server";
import { joinLoyalty, getRewardsSummary, requestRedemption, claimGuestDayPoints } from "@/lib/db";
import { getOrCreateGuestId } from "@/lib/guestId";
import { LOYALTY } from "@/lib/constants";

export const maxDuration = 15;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to view rewards" }, { status: 401 });
  try {
    const summary = await getRewardsSummary(userId);
    return Response.json({ ...summary, config: LOYALTY });
  } catch (err) {
    console.error("Rewards summary failed:", err);
    return Response.json({ error: "Could not load rewards" }, { status: 500 });
  }
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  try {
    if (body.action === "join") {
      await joinLoyalty(userId);
      // The registration hook: today's guest points (if this browser was
      // searching as a guest before signing up) convert on join, once.
      const guestId = await getOrCreateGuestId();
      const claimed = await claimGuestDayPoints(userId, guestId);
      return Response.json({ ok: true, claimed });
    }

    if (body.action === "redeem") {
      const points = Math.floor(Number(body.points));
      const voucherType = String(body.voucherType || "");
      if (!LOYALTY.DENOMINATIONS.includes(points)) {
        return Response.json({ error: `Vouchers come in ${LOYALTY.DENOMINATIONS.join(" / ")} point denominations.` }, { status: 400 });
      }
      if (!LOYALTY.VOUCHER_CATALOG.some((v) => v.brand === voucherType)) {
        return Response.json({ error: "Pick a voucher from the list." }, { status: 400 });
      }
      const summary = await getRewardsSummary(userId);
      if (!summary.isMember) return Response.json({ error: "Join the programme first." }, { status: 400 });
      if (summary.plan !== "plus") {
        return Response.json({ error: "Redemption is a Plus feature — upgrade to redeem your points. They keep accumulating meanwhile." }, { status: 403 });
      }
      const ok = await requestRedemption(userId, points, voucherType);
      if (!ok) return Response.json({ error: "Not enough available points for that voucher." }, { status: 400 });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Rewards action failed:", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
