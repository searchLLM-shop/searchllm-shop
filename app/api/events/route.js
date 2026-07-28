// app/api/events/route.js
//
// Records lightweight analytics events (a visit, an affiliate click). Public
// by necessity — it's called from the browser — so it accepts only a fixed
// set of event types and stores nothing free-form. No query text, no page
// URLs, no fingerprinting: just "this kind of thing happened, on this day,
// from this country", plus the same rotating identity already used for quota
// counting so unique visitors can be counted without profiling anyone.

import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import { recordEvent } from "@/lib/db";

// pwa_standalone_visit is the load-bearing one: iOS fires no install
// event at all, so "sessions opened from the installed app" is the only
// metric that counts every platform — and it measures real usage, not
// just an install that was never opened again.
const ALLOWED = new Set([
  "visit",
  "affiliate_click",
  "pwa_installed",
  "pwa_standalone_visit",
  "pwa_prompt_dismissed",
]);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { eventType, listingId, network, utm } = body;

    if (!ALLOWED.has(eventType)) {
      return Response.json({ error: "Unsupported event" }, { status: 400 });
    }

    const { userId } = await auth();
    const identity = userId || (await getOrCreateGuestId());
    const country =
      req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || null;

    // Truncate hard: these are labels for reporting, not free-form storage.
    const clean = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null);

    await recordEvent({
      eventType,
      identity,
      listingId: Number.isInteger(listingId) ? listingId : null,
      network: typeof network === "string" ? network.slice(0, 40) : null,
      country,
      utm: utm ? {
        source: clean(utm.source),
        medium: clean(utm.medium),
        campaign: clean(utm.campaign),
        referrerHost: clean(utm.referrerHost),
      } : null,
    });

    return Response.json({ ok: true });
  } catch (err) {
    // Analytics must never break the user's experience.
    console.error("Event recording failed:", err.message);
    return Response.json({ ok: false }, { status: 200 });
  }
}
