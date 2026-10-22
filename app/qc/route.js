// app/qc/route.js
//
// Click-through for the quick-commerce handoff links (lib/quickCommerce.js).
// Records WHICH platform was tapped — and nothing else: not the search term,
// not the shopper's question — then redirects to that app's own search page.
// Never blocks the shopper: a logging failure still redirects.
//
//   GET /qc?p=blinkit&q=whey%20protein

import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import { recordEvent } from "@/lib/db";
import { QC_PLATFORMS, enabledPlatforms, buildQuickCommerceUrl } from "@/lib/quickCommerce";

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const platform = String(params.get("p") || "").toLowerCase();
  const url = enabledPlatforms().includes(platform) ? buildQuickCommerceUrl(platform, params.get("q")) : null;
  if (!url || !QC_PLATFORMS[platform]) return Response.redirect(new URL("/", req.url), 302);

  try {
    const { userId } = await auth();
    const identity = userId || (await getOrCreateGuestId());
    await recordEvent({
      eventType: "qc_click",
      identity,
      network: platform,
      country: req.headers.get("x-vercel-ip-country") || null,
    });
  } catch (err) {
    console.error("Quick-commerce click record failed:", err.message);
  }
  return Response.redirect(url, 302);
}
