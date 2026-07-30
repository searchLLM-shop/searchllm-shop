// app/alt/route.js
//
// Outbound redirect for ALTERNATIVE products — the ones the model chose
// without any commercial input. These now carry the Amazon Associates tag,
// so they CAN earn a commission; the on-page disclosure was rewritten to
// say so plainly rather than claiming we earn nothing from them.
//
// The honesty claim that still holds, and the one that actually matters:
// the model selects these alternatives with no knowledge of what we earn
// on anything. Monetizing the click doesn't touch the selection.
//
// Click counts are still recorded as brand-demand evidence — per-product
// volume is what convinces a brand manager to list with us.
// No points, no gates: nothing here to game, nothing worth blocking.

import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import { recordAltClick } from "@/lib/db";

const CONTEXTS = new Set(["research", "answer"]);

export async function GET(req) {
  const url = new URL(req.url);
  const product = (url.searchParams.get("p") || "").slice(0, 160).trim();
  const brand = (url.searchParams.get("b") || "").slice(0, 80).trim();
  const ctxParam = url.searchParams.get("ctx");
  if (!product) return Response.redirect(new URL("/", req.url), 302);

  let identity = null;
  try {
    const { userId } = await auth();
    identity = userId || (await getOrCreateGuestId());
  } catch {}

  try {
    await recordAltClick({
      brand: brand || null,
      product,
      identity,
      context: CONTEXTS.has(ctxParam) ? ctxParam : null,
    });
  } catch (err) {
    console.error("Alt click record failed:", err.message);
  }

  // Destination policy (2026-07-30): send shoppers to Amazon, where they can
  // actually buy, rather than to a search page they have to work through.
  //
  // A note on the fallback you might expect here: "Amazon, else the brand's
  // own site, else Google" can't be implemented reliably without querying
  // Amazon first — and that needs PA-API access, which arrives after the
  // qualifying-sales threshold. Until then an Amazon SEARCH is the honest
  // equivalent: it lands on real listings when they exist and on Amazon's
  // own "no results" page when they don't, which is a better dead end than
  // a Google page. Revisit once PA-API keys are live.
  const term = `${brand} ${product}`.trim();
  const tag = process.env.AMAZON_ASSOCIATES_TAG;
  if (tag) {
    return Response.redirect(
      `https://www.amazon.in/s?k=${encodeURIComponent(term.slice(0, 120))}&tag=${tag}`,
      302
    );
  }
  // No Associates tag configured — fall back to a plain web search rather
  // than sending untagged traffic.
  return Response.redirect(
    `https://www.google.com/search?q=${encodeURIComponent(`${term} buy online india`)}`,
    302
  );
}
