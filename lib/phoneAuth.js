// lib/phoneAuth.js
//
// Custom phone-OTP sign-up/sign-in, replacing Clerk's own prebuilt phone
// flow (2026-09-22, RBI data-localization fix — see schema.sql's comment
// on user_identities/phone_otps for the full story). Clerk still issues
// the session/JWT everything else in the app depends on
// (auth()/currentUser() are unchanged) — this file only changes HOW a
// session gets created: the real phone number is generated, verified,
// and stored entirely on our own India-hosted infrastructure (lib/db.js's
// issuePhoneOtp/verifyPhoneOtp/user_identities), and Clerk is handed
// nothing but an opaque, non-PII identifier.
//
// Calls Clerk's REST Backend API directly (not the @clerk/nextjs SDK's
// resource clients) for the two operations that need it — creating a
// user with no real PII, and minting a sign-in token — since those exact
// request shapes were verified directly against Clerk's current docs
// (2026-09-22) and a direct fetch removes any uncertainty about SDK
// method-name coverage for those two specific calls. Every other Clerk
// interaction in this app (auth(), currentUser(), the admin reports'
// clerkClient().users.getUserList()) is untouched.
//
// EXTERNAL PREREQUISITES (not fixable in code — see the hand-off notes):
//   1. An MSG91 account + a DLT-approved SMS template (MSG91_API_KEY,
//      MSG91_SENDER_ID, MSG91_TEMPLATE_ID below). Used purely as a
//      transactional SMS transport — MSG91 never generates, sees, or
//      stores the OTP as a phone+code pair; we hand it a rendered
//      message and it sends it.
//   2. Clerk's dashboard (Configure -> User & Authentication) must allow
//      "Username" as an identifier (even though nothing here ever shows
//      a username to a shopper) — Clerk requires at least one of
//      email/phone/username per user, and email/phone are exactly what
//      this file must never send it.

import { hashPhone, issuePhoneOtp, verifyPhoneOtp, getUserIdentityByPhoneHash, createUserIdentity } from "@/lib/db";
import { isAdminPhone } from "@/lib/isAdmin";
import { randomUUID } from "crypto";

function isConfigured() {
  return Boolean(process.env.MSG91_API_KEY && process.env.MSG91_SENDER_ID && process.env.MSG91_TEMPLATE_ID);
}

// Plain +91 normalization — same convention as lib/db.js's hashPhone and
// lib/isAdmin.js's last10Digits (compare by the last 10 digits so it
// doesn't matter how the shopper typed it).
function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `91${digits}` : null;
}

// MSG91's transactional (non-OTP-widget) send API — see this file's own
// header comment for why the widget/SendOTP+VerifyOTP bundle is
// deliberately NOT used. Exact current endpoint/payload shape should be
// re-checked against MSG91's live docs at the time MSG91_API_KEY is
// actually issued — this targets their documented Flow/SMS v2 send API
// as of 2026-09-22.
async function sendSms(e164, message) {
  if (!isConfigured()) {
    console.error("MSG91 not configured (MSG91_API_KEY/MSG91_SENDER_ID/MSG91_TEMPLATE_ID) — OTP not sent.");
    return { ok: false, reason: "SMS sending is not configured yet." };
  }
  try {
    const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: process.env.MSG91_API_KEY },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID,
        sender: process.env.MSG91_SENDER_ID,
        recipients: [{ mobiles: e164, VAR1: message }],
      }),
    });
    if (!resp.ok) {
      console.error("MSG91 send failed:", resp.status, await resp.text().catch(() => ""));
      return { ok: false, reason: "Could not send the code — please try again." };
    }
    return { ok: true };
  } catch (err) {
    console.error("MSG91 send error:", err.message);
    return { ok: false, reason: "Could not send the code — please try again." };
  }
}

// Step 1: shopper enters a phone number.
export async function requestOtp(phone) {
  const e164 = toE164(phone);
  if (!e164) return { ok: false, reason: "Enter a valid 10-digit mobile number." };
  const phoneHash = hashPhone(phone);
  const issued = await issuePhoneOtp(phoneHash);
  if (!issued.ok) return issued; // cooldown message
  const sent = await sendSms(e164, `${issued.otp} is your SearchLLM verification code. Valid for 5 minutes.`);
  if (!sent.ok) return sent;
  return { ok: true };
}

// Step 2: shopper enters the code. On success, returns a Clerk sign-in
// token the client exchanges for a real session (see
// app/api/auth/verify-otp/route.js) — new phone -> new opaque Clerk
// user + a fresh user_identities row; known phone -> a sign-in token for
// their EXISTING clerk_user_id, so points/referral/redemption history
// (all keyed on Clerk user ID) carries over exactly as before.
export async function verifyOtpAndSignIn(phone, code) {
  const phoneHash = hashPhone(phone);
  if (!phoneHash) return { ok: false, reason: "Enter a valid 10-digit mobile number." };
  const verified = await verifyPhoneOtp(phoneHash, code);
  if (!verified.ok) return verified;

  let clerkUserId = await getUserIdentityByPhoneHash(phoneHash);
  if (!clerkUserId) {
    // The one place this file ever checks the real number against
    // ADMIN_PHONES — done here, before the number is handed to Clerk at
    // all, so admin status can be baked into publicMetadata at creation
    // time (lib/isAdmin.js's primary check now) without Clerk ever
    // needing to see the phone itself.
    const created = await createClerkUser(isAdminPhone(phone));
    if (!created.ok) return created;
    clerkUserId = created.userId;
    await createUserIdentity(clerkUserId, phone);
  }

  const token = await createSignInToken(clerkUserId);
  if (!token.ok) return token;
  return { ok: true, clerkUserId, signInToken: token.token };
}

// Creates a Clerk user holding NO real PII — a synthetic, opaque
// username is the identifier Clerk requires (it needs at least one of
// email/phone/username per user; email and phone are exactly what must
// never be the real ones). Requires "Username" enabled as an allowed
// identifier in Clerk's own dashboard — see this file's header comment.
async function createClerkUser(grantAdmin) {
  const opaqueId = randomUUID();
  try {
    const resp = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: `u_${opaqueId.replace(/-/g, "")}`,
        external_id: opaqueId,
        skip_password_checks: true,
        skip_password_requirement: true,
        // public_metadata is readable client-side (useUser()'s
        // user.publicMetadata) and server-side (currentUser()'s same
        // field) — the one flag lib/isAdmin.js and app/page.jsx's
        // useIsAdminClientHint now check first.
        public_metadata: grantAdmin ? { isAdmin: true } : undefined,
      }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error("Clerk createUser failed:", resp.status, JSON.stringify(data));
      return { ok: false, reason: "Could not create your account — please try again." };
    }
    return { ok: true, userId: data.id };
  } catch (err) {
    console.error("Clerk createUser error:", err.message);
    return { ok: false, reason: "Could not create your account — please try again." };
  }
}

// POST https://api.clerk.com/v1/sign_in_tokens — verified against
// Clerk's current docs (2026-09-22). Short-lived and single-use by
// design (Clerk's own semantics for this endpoint): the client exchanges
// it for a real session via the "ticket" strategy immediately after this
// returns, so there's only ever a few seconds where the token is live.
async function createSignInToken(clerkUserId) {
  try {
    const resp = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 60 }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error("Clerk createSignInToken failed:", resp.status, JSON.stringify(data));
      return { ok: false, reason: "Could not sign you in — please try again." };
    }
    return { ok: true, token: data.token };
  } catch (err) {
    console.error("Clerk createSignInToken error:", err.message);
    return { ok: false, reason: "Could not sign you in — please try again." };
  }
}
