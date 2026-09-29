// app/api/marketing-consent/route.js
//
// Standing on/off promotional-consent preferences — separate from the
// privacy_requests request/response flow, and separate from the
// mandatory account-use consent gate (see schema.sql's marketing_consent
// comment for why DPDP requires that separation).
//
// GET  -> the signed-in user's current sms/email consent state.
// POST {channel: "sms", consent: true|false} -> toggle SMS consent,
//   either direction — uses the phone already on file, nothing else needed.
// POST {channel: "email", consent: false} -> opt OUT of email marketing.
// POST {channel: "email", consent: true} -> re-opt IN, reusing the email
//   already on file from a past redemption. Fails if none exists yet —
//   the first opt-in only ever happens at redemption time (see
//   app/api/rewards/route.js), since that's the one place an email is
//   collected at all.

import { auth } from "@clerk/nextjs/server";
import { getMarketingConsent, setSmsMarketingConsent, setEmailMarketingConsentOut, setEmailMarketingConsentBackIn } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const consent = await getMarketingConsent(userId);
  return Response.json(consent);
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  if (body?.channel === "sms") {
    await setSmsMarketingConsent(userId, body.consent === true);
    return Response.json({ ok: true });
  }

  if (body?.channel === "email") {
    if (body.consent === false) {
      await setEmailMarketingConsentOut(userId);
      return Response.json({ ok: true });
    }
    const result = await setEmailMarketingConsentBackIn(userId);
    if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Pass {channel: 'sms'|'email', consent: true|false}" }, { status: 400 });
}
