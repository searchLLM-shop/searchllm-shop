// app/go/[trackingId]/route.js
//
// Outbound click redirect for DIRECT advertisers. Every click gets a unique
// click_id which is appended to the destination URL. The advertiser echoes
// that id back in the conversion postback, and that echo is the entire basis
// of attribution — without it we would be trusting a self-reported sales
// figure, which is not a business.
//
// The redirect is a 302 and does no blocking work beyond one insert, so the
// shopper experiences it as an ordinary link.

import { redirect } from "next/navigation";
import { getProductByTrackingId, recordAdvertiserClick, newToken } from "@/lib/db";

export async function GET(req, { params }) {
  const { trackingId } = await params;

  let product;
  try {
    product = await getProductByTrackingId(trackingId);
  } catch (err) {
    console.error("Click lookup failed:", err.message);
    return Response.redirect(new URL("/", req.url), 302);
  }

  // Unknown link, unapproved product, or a paused advertiser: send the shopper
  // to the homepage rather than an error page.
  if (!product || product.status !== "approved" || product.advertiser_status !== "approved") {
    return Response.redirect(new URL("/", req.url), 302);
  }

  const clickId = newToken(12);
  const country = req.headers.get("x-vercel-ip-country") || null;

  try {
    await recordAdvertiserClick({
      clickId,
      advertiserId: product.adv_id,
      productId: product.id,
      country,
    });
  } catch (err) {
    // Never block the shopper because our logging failed.
    console.error("Click record failed:", err.message);
  }

  let destination;
  try {
    destination = new URL(product.destination_url);
  } catch {
    return Response.redirect(new URL("/", req.url), 302);
  }
  // Standard affiliate parameter names so advertisers recognise them.
  destination.searchParams.set("click_id", clickId);
  destination.searchParams.set("utm_source", "searchllm");
  destination.searchParams.set("utm_medium", "affiliate");

  return Response.redirect(destination.toString(), 302);
}
