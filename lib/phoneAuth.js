// lib/phoneAuth.js
//
// Custom phone-OTP sign-up/sign-in, replacing Clerk's own prebuilt phone
// flow (2026-09-22, RBI data-localization fix — see schema.sql's comment
// on user_identities for the full story). Clerk still issues the
// session/JWT everything else in the app depends on (auth()/currentUser()
// are unchanged) — this file only changes HOW a session gets created: the
// real phone number's PERSISTENT identity record lives entirely on our
// own India-hosted infrastructure (lib/db.js's user_identities), and
// Clerk is handed nothing but an opaque, non-PII identifier.
//
// 2026-09-27: OTP generation, delivery, and verification are handled
// directly by MSG91's own OTP Verification API (control.msg91.com/api/v5/
// otp + /api/v5/otp/verify) — not by us. We never generate, hash, or
// store the code; we just call Send, then later call Verify with what
// the shopper typed. This does NOT reopen the compliance gap this file
// exists to fix: the original problem was the *persistent* phone+identity
// record sitting on non-India (Clerk) infrastructure. MSG91 is an Indian
// SMS/OTP provider that necessarily sees the phone number to deliver the
// text (true of any SMS gateway, self-issued OTP or not) and holds the
// OTP itself only as a disposable few-minute challenge, never an
// identity record — a fundamentally different, much lower-stakes case
// than what Clerk was doing. Request/response shapes below verified
// directly against MSG91's live docs (docs.msg91.com/otp/sendotp,
// /otp/verify-otp) on 2026-09-27, and cross-checked against a real
// confirmed-working call the user ran themselves.
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
// Env vars required:
//   MSG91_AUTH_KEY     - MSG91 account authkey (control panel -> API)
//   MSG91_TEMPLATE_ID  - the DLT-approved OTP template's id (MSG91's OTP
//                         section), template text: "{#var#} is your OTP
//                         from PIBITS - SearchLLM. Valid for 5 minutes.
//                         Do not share this code with anyone."
// Also still required: Clerk's dashboard (Configure -> User &
// Authentication) must allow "Username" as an identifier — Clerk
// requires at least one of email/phone/username per user, and
// email/phone are exactly what this file must never send it.

import { hashPhone, checkOtpSendCooldown, getUserIdentityByPhoneHash, createUserIdentity } from "@/lib/db";
import { isAdminPhone } from "@/lib/isAdmin";
import { randomUUID } from "crypto";

const MSG91_BASE = "https://control.msg91.com/api/v5/otp";
const OTP_EXPIRY_MINUTES = 5;

function isConfigured() {
  return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
}

// MSG91 wants the number in international format with no "+" (e.g.
// "918595870721") — same last-10-digits normalization as hashPhone/
// isAdminPhone, just prefixed with the country code.
function toMsg91Mobile(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `91${digits}` : null;
}

// Step 1: shopper enters a phone number. MSG91 generates the OTP itself
// (the blank `otp=` param below means "you generate it") and sends it
// using the approved DLT template — we never see the code.
export async function requestOtp(phone) {
  const mobile = toMsg91Mobile(phone);
  if (!mobile) return { ok: false, reason: "Enter a valid 10-digit mobile number." };
  if (!isConfigured()) {
    console.error("MSG91 not configured (MSG91_AUTH_KEY/MSG91_TEMPLATE_ID) — OTP not sent.");
    return { ok: false, reason: "SMS sending is not configured yet." };
  }

  const phoneHash = hashPhone(phone);
  const cooldown = await checkOtpSendCooldown(phoneHash);
  if (!cooldown.ok) return cooldown;

  try {
    const url = `${MSG91_BASE}?otp=&mobile=${mobile}&otp_expiry=${OTP_EXPIRY_MINUTES}&template_id=${process.env.MSG91_TEMPLATE_ID}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { authkey: process.env.MSG91_AUTH_KEY, "content-type": "application/json" },
    });
    const data = await resp.json().catch(() => null);
    if (data?.type !== "success") {
      console.error("MSG91 send-otp failed:", resp.status, JSON.stringify(data));
      return { ok: false, reason: "Could not send the code — please try again." };
    }
    return { ok: true };
  } catch (err) {
    console.error("MSG91 send-otp error:", err.message);
    return { ok: false, reason: "Could not send the code — please try again." };
  }
}

// Step 2: shopper enters the code. Verified directly against MSG91 (they
// own the OTP's state — expiry, attempt count, everything). On success,
// returns a Clerk sign-in token the client exchanges for a real session
// (see app/api/auth/verify-otp/route.js) — new phone -> new opaque Clerk
// user + a fresh user_identities row; known phone -> a sign-in token for
// their EXISTING clerk_user_id, so points/referral/redemption history
// (all keyed on Clerk user ID) carries over exactly as before.
export async function verifyOtpAndSignIn(phone, code) {
  const mobile = toMsg91Mobile(phone);
  if (!mobile) return { ok: false, reason: "Enter a valid 10-digit mobile number." };
  if (!isConfigured()) return { ok: false, reason: "SMS sending is not configured yet." };

  try {
    const url = `${MSG91_BASE}/verify?otp=${encodeURIComponent(code)}&mobile=${mobile}`;
    const resp = await fetch(url, { method: "GET", headers: { authkey: process.env.MSG91_AUTH_KEY } });
    const data = await resp.json().catch(() => null);
    if (data?.type !== "success") {
      // MSG91's own message field is already shopper-safe ("OTP expired",
      // "OTP not match", etc.) — surface it directly rather than a
      // generic string.
      return { ok: false, reason: data?.message || "Incorrect code." };
    }
  } catch (err) {
    console.error("MSG91 verify-otp error:", err.message);
    return { ok: false, reason: "Could not verify the code — please try again." };
  }

  const phoneHash = hashPhone(phone);
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
