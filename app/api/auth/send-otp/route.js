// app/api/auth/send-otp/route.js
//
// Step 1 of the custom phone sign-in flow (2026-09-22, replacing Clerk's
// own phone modal — see lib/phoneAuth.js's header comment for the full
// story). No auth required: this IS the auth step. Rate-limited per-IP
// (same hashIp/recordAndCheckIp fair-use gate every other unauthenticated
// route uses) on top of lib/db.js's own per-phone cooldown inside
// issuePhoneOtp, so neither a single phone nor a single connection can be
// used to spam SMS sends.

import { requestOtp } from "@/lib/phoneAuth";
import { hashIp, recordAndCheckIp } from "@/lib/db";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const phone = String(body?.phone || "").trim();
  if (!phone) return Response.json({ error: "Enter a mobile number." }, { status: 400 });

  try {
    const ipHash = hashIp(req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim());
    const { clickGated } = await recordAndCheckIp(ipHash, "click"); // reuses the existing click-rate bucket; this route has no bucket of its own
    if (clickGated) return Response.json({ error: "Too many requests from this network — try again later." }, { status: 429 });
  } catch (err) {
    console.error("send-otp IP gate failed:", err.message);
  }

  const result = await requestOtp(phone);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true });
}
