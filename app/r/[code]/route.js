// app/r/[code]/route.js
//
// The referral share-link landing route. A registered user shares
// https://searchllm.shop/r/<their code> via their own WhatsApp (a wa.me
// deep link — see app/api/referrals/route.js). This route just verifies
// the code exists, sets a short-lived attribution cookie, and sends the
// visitor home — no database write happens here at all. The referral
// itself is only ever recorded once the visitor actually completes a
// genuinely new registration (see confirmReferral in lib/db.js, invoked
// from POST /api/referrals) — this route is not the thing that credits
// anything, it's just how the intent to credit later gets remembered.
//
// Unknown/invalid codes redirect home silently, same fallback behavior as
// app/go/[trackingId]/route.js.

import { cookies } from "next/headers";
import { referralCodeExists } from "@/lib/db";

const COOKIE_NAME = "sllm_referral_code";

export async function GET(req, { params }) {
  const { code } = await params;

  let exists = false;
  try {
    exists = await referralCodeExists(code);
  } catch (err) {
    console.error("Referral code lookup failed:", err.message);
  }

  if (exists) {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, code, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30, // 30 days — shorter than the guest-id cookie's
      // 90, since referral click-to-signup intent decays faster than general
      // guest search activity.
      path: "/",
    });
  }

  return Response.redirect(new URL("/", req.url), 302);
}
