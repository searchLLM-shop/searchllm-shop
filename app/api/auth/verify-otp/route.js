// app/api/auth/verify-otp/route.js
//
// Step 2 of the custom phone sign-in flow (2026-09-22) — see
// lib/phoneAuth.js's header comment. On success, returns a short-lived
// Clerk sign-in token; the client exchanges it for a real session via
// Clerk's "ticket" strategy (components/PhoneAuthModal.jsx) — Clerk
// issues the session exactly as before, it just never learns the real
// phone number.

import { verifyOtpAndSignIn } from "@/lib/phoneAuth";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const phone = String(body?.phone || "").trim();
  const code = String(body?.code || "").trim();
  if (!phone || !code) return Response.json({ error: "Enter the code sent to your phone." }, { status: 400 });

  const result = await verifyOtpAndSignIn(phone, code);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true, signInToken: result.signInToken });
}
