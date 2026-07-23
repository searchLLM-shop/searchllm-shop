// app/alt/route.js
//
// Outbound redirect for ALTERNATIVE products — the ones we recommend with
// no affiliate relationship. Deliberately links to a neutral web search
// (never a monetized destination): the alternatives section is the proof
// that advice comes before revenue, and that only stays true if these
// links earn us nothing. What we DO take is the count — per-brand click
// volume is the evidence that convinces a brand manager to list.
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

  const q = encodeURIComponent(`${brand} ${product} buy online india`.trim());
  return Response.redirect(`https://www.google.com/search?q=${q}`, 302);
}
