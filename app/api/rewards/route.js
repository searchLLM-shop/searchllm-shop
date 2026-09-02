// app/api/rewards/route.js
//
// The member-facing rewards API. Accounts only — points need a durable
// identity, and guest cookies rotate — and strictly opt-in: joining is an
// explicit consent action (see the join screen and Privacy Policy section).
// Points come from search and click activity only (purchase points were
// removed 2026-08-25 — see the LOYALTY.POINTS comment in lib/constants.js)
// — nothing about a member's purchases is ever linked to this programme.

import { auth, currentUser } from "@clerk/nextjs/server";
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
      // name, mobile, email and postal address are required for every
      // redemption. Name/mobile/email are NOT taken from the request body
      // any more (2026-09-02) — they're read straight from the signed-in
      // Clerk account, which is now the single source of truth for those
      // fields (collected as mandatory at sign-up; editable only via the
      // account's own Clerk profile, never on this form). This also closes
      // a trust gap: a client could previously claim any name it liked
      // here, whether or not it matched the signed-in account.
      const account = await currentUser();
      const rawMobile = account?.primaryPhoneNumber?.phoneNumber || "";
      const kyc = {
        firstName: String(account?.firstName || "").trim().slice(0, 80),
        lastName: String(account?.lastName || "").trim().slice(0, 80),
        mobile: rawMobile.replace(/\D/g, "").slice(-10),
        email: String(account?.primaryEmailAddress?.emailAddress || "").trim().slice(0, 200),
        address: String(body.address || "").trim().slice(0, 400),
      };
      if (!kyc.firstName || !kyc.lastName || !/^\d{10}$/.test(kyc.mobile) || !kyc.email) {
        return Response.json({ error: "Your account is missing a first name, last name, mobile number or email — complete your profile before redeeming. This is required for gift voucher issuance in India." }, { status: 400 });
      }
      if (!kyc.address) {
        return Response.json({ error: "Enter the address this voucher should be issued against." }, { status: 400 });
      }
      if (body.kycConfirmed !== true) {
        return Response.json({ error: "Please confirm your details before redeeming — required for gift voucher issuance in India." }, { status: 400 });
      }

      const summary = await getRewardsSummary(userId);
      if (!summary.isMember) return Response.json({ error: "Join the programme first." }, { status: 400 });
      // No plan check (2026-08-25: no plans exist) — requestRedemption's
      // own balance check is sufficient, since earning can never cross an
      // unpaid block boundary in the first place.
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
