// app/api/referrals/route.js
//
// The referral programme API — registered users only. A referrer shares a
// personal link via their own WhatsApp; each CONFIRMED new registration
// earns them REFERRALS.POINTS_PER_REFERRAL points, capped at
// REFERRALS.MAX_REFERRALS for life (see lib/constants.js).
//
// GET  -> the signed-in user's own referral summary (code, share link,
//   WhatsApp share URL, progress, history).
// POST {action:"confirm"} -> attempts to credit whoever referred THIS
//   signed-in user, if they arrived via a referral link and this is
//   genuinely a brand-new account. Called opportunistically from the
//   client on every signed-in page load (app/page.jsx) — safe to call
//   repeatedly, it's a no-op once already processed (or if there was
//   never a referral cookie to begin with).

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getReferralsSummary, confirmReferral } from "@/lib/db";

const COOKIE_NAME = "sllm_referral_code";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://searchllm.shop";

// How long after account creation a first load still counts as "this is
// the sign-up completing", not "an existing user clicking the link later
// and trying to retroactively count as referred". Generous enough to cover
// any real sign-up-to-first-load delay, tight enough to exclude old
// accounts entirely.
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

function shareUrls(code) {
  const link = `${SITE_URL}/r/${code}`;
  const pitch = "I've been using SearchLLM.shop for honest AI shopping picks — it never gets paid to recommend anything, and even tells you when the cheap option is fine. Try it:";
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${pitch} ${link}`)}`;
  return { link, whatsapp };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to refer friends" }, { status: 401 });
  try {
    const summary = await getReferralsSummary(userId);
    return Response.json({ ...summary, ...shareUrls(summary.code) });
  } catch (err) {
    console.error("Referrals summary failed:", err);
    return Response.json({ error: "Could not load referrals" }, { status: 500 });
  }
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  if (body.action !== "confirm") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const code = cookieStore.get(COOKIE_NAME)?.value;
  if (!code) return Response.json({ ok: false, reason: "no referral pending" });

  try {
    const account = await currentUser();
    const createdAt = account?.createdAt ? new Date(account.createdAt).getTime() : 0;
    const isFreshAccount = createdAt > 0 && Date.now() - createdAt < NEW_ACCOUNT_WINDOW_MS;
    if (!isFreshAccount) {
      // Not a new sign-up — an existing user clicked a referral link at
      // some point. Clear the cookie so this stops being re-checked, but
      // credit nothing.
      cookieStore.delete(COOKIE_NAME);
      return Response.json({ ok: false, reason: "not a new registration" });
    }

    const result = await confirmReferral({ referredUserId: userId, code });
    // Clear the cookie either way once resolved — success, self-referral,
    // already-claimed, or cap-reached are all definitive outcomes; nothing
    // is gained by re-attempting on every future load.
    cookieStore.delete(COOKIE_NAME);
    return Response.json(result);
  } catch (err) {
    console.error("Referral confirm failed:", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
