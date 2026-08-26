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

      // RBI mandate for gift vouchers issued in India: first name, last
      // name, mobile, email and address are required and must be explicitly
      // (re-)confirmed on EVERY redemption, even when prefilled from what's
      // on file — see requestRedemption in lib/db.js for how this is stored.
      const kyc = {
        firstName: String(body.kyc?.firstName || "").trim().slice(0, 80),
        lastName: String(body.kyc?.lastName || "").trim().slice(0, 80),
        mobile: String(body.kyc?.mobile || "").trim().slice(0, 15),
        email: String(body.kyc?.email || "").trim().slice(0, 200),
        address: String(body.kyc?.address || "").trim().slice(0, 400),
      };
      if (!kyc.firstName || !kyc.lastName || !kyc.address) {
        return Response.json({ error: "First name, last name and address are required for gift voucher issuance." }, { status: 400 });
      }
      if (!/^\d{10}$/.test(kyc.mobile)) {
        return Response.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kyc.email)) {
        return Response.json({ error: "Enter a valid email address." }, { status: 400 });
      }
      if (body.kycConfirmed !== true) {
        return Response.json({ error: "Please confirm your details before redeeming — required for gift voucher issuance in India." }, { status: 400 });
      }

      const summary = await getRewardsSummary(userId);
      if (!summary.isMember) return Response.json({ error: "Join the programme first." }, { status: 400 });
      if (summary.plan !== "plus") {
        return Response.json({ error: "Redemption is a Plus feature — upgrade to redeem your points. They keep accumulating meanwhile." }, { status: 403 });
      }
      const ok = await requestRedemption(userId, points, voucherType, kyc);
      if (!ok) return Response.json({ error: "Not enough available points for that voucher." }, { status: 400 });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Rewards action failed:", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
