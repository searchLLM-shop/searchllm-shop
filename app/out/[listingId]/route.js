// app/out/[listingId]/route.js
//
// Outbound click redirect for affiliate NETWORK links (vCommission, Awin) —
// the network-side twin of /go/[trackingId], which serves direct advertisers.
//
// Why a redirect instead of linking straight to the network URL:
// 1. Every click gets a unique click_id, recorded against the (rotating)
//    user/guest identity BEFORE the shopper leaves. The click_id rides along
//    to the network as a sub-ID and comes back in transaction reports, which
//    is what makes per-click conversion attribution possible — the foundation
//    the loyalty programme will stand on.
// 2. The affiliate_click analytics event is recorded server-side here, which
//    is more reliable than the old client-side sendBeacon (ad blockers eat
//    beacons; they don't eat navigations).
// The shopper experiences it as an ordinary link: one insert, then a 302.
//
// Privacy: only the opaque click_id crosses the wire to the network. The
// identity stays in our database, same as it already did for click events.

import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import { getApprovedListingById, recordNetworkClick, recordEvent, newToken, creditClickPoints, getLifecycleStatus, hashIp, recordIpActivity, getIpGate } from "@/lib/db";
import { buildOutboundUrl } from "@/lib/outbound";

const CONTEXTS = new Set(["research", "answer"]);

export async function GET(req, { params }) {
  const { listingId } = await params;
  const id = Number.parseInt(listingId, 10);
  if (!Number.isInteger(id)) return Response.redirect(new URL("/", req.url), 302);

  let listing;
  try {
    listing = await getApprovedListingById(id);
  } catch (err) {
    console.error("Outbound lookup failed:", err.message);
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Unknown, unapproved, or market-paused listing: homepage, not an error.
  if (!listing || !listing.networkLink) {
    return Response.redirect(new URL("/", req.url), 302);
  }

  const clickId = newToken(12);
  const ctxParam = new URL(req.url).searchParams.get("ctx");
  const context = CONTEXTS.has(ctxParam) ? ctxParam : null;
  const country = req.headers.get("x-vercel-ip-country") || null;

  // Channel links (WhatsApp) carry identity explicitly, because a chat tap
  // has no browser session with our cookies. ONLY the wa: prefix is
  // accepted from the query string — a Clerk user id or guest id can never
  // be injected this way, so click attribution for real accounts remains
  // cookie/session-derived and unspoofable.
  const explicitId = new URL(req.url).searchParams.get("i");
  let identity = explicitId && explicitId.startsWith("wa:") ? explicitId.slice(0, 40) : null;
  let clerkUserId = null;
  try {
    const { userId } = await auth();
    clerkUserId = userId || null;
    if (!identity) identity = userId || (await getOrCreateGuestId());
  } catch {
    // Identity is attribution metadata, never a reason to block a shopper.
  }

  // BLOCKING click gate (decision 2026-07-23): a user who has clicked
  // their plan's allowance of affiliate links since their last purchase or
  // recharge is redirected to the gate instead of the store — no click row,
  // no points, no network hit — until Increase Usage or a purchase resets
  // the cycle. IP-level limits apply to everyone without a payment/purchase
  // history, which also covers guests hopping accounts.
  try {
    const ipHash = hashIp(req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim());
    let gated = false;
    let hasCredit = false;
    if (clerkUserId) {
      const lc = await getLifecycleStatus(clerkUserId);
      gated = lc.clickGated;
      hasCredit = lc.hasCredit;
    }
    if (!gated && !hasCredit) {
      gated = (await getIpGate(ipHash)).clickGated;
    }
    if (gated) {
      return Response.redirect(new URL("/?gate=click", req.url), 302);
    }
    recordIpActivity(ipHash, "click").catch(() => {});
  } catch (err) {
    console.error("Click gate check failed:", err.message);
  }

  // Click points: the action closest to revenue (5, once per product per
  // day). Signed-in users only; best-effort — a points hiccup must never
  // slow the redirect.
  if (clerkUserId) {
    creditClickPoints(clerkUserId, id).catch((e) => console.error("Click points failed:", e.message));
  }

  // Record the click row and the analytics event, but never at the shopper's
  // expense — a logging failure still redirects.
  try {
    await recordNetworkClick({
      clickId,
      listingId: listing.id,
      network: listing.network,
      identity,
      context,
      country,
    });
  } catch (err) {
    console.error("Network click record failed:", err.message);
  }
  try {
    await recordEvent({
      eventType: "affiliate_click",
      identity,
      listingId: listing.id,
      network: listing.network,
      country,
    });
  } catch (err) {
    console.error("Click event record failed:", err.message);
  }

  // Attach the click_id as the network's sub-ID. If the stored link is
  // somehow malformed, fall back to it raw — a shopper mid-click is not the
  // moment to surface a data-quality problem.
  const destination = buildOutboundUrl(listing.networkLink, listing.network, clickId) || listing.networkLink;
  return Response.redirect(destination, 302);
}
