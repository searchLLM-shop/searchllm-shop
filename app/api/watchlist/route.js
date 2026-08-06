// app/api/watchlist/route.js
//
// Price-drop watchlist, shopper-facing side. GET returns the signed-in-or-
// guest identity's watches plus recent alerts; POST adds a watch; DELETE
// removes one. The actual price checking happens in
// app/api/admin/pricecheck (a cron), not here — this route only ever reads
// or writes the watch itself, same separation of concerns as the rest of
// the app (research/route.js never does listing sync work either).

import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import { addWatch, removeWatch, listWatchesForIdentity, listAlertsForIdentity, countUnseenAlerts, markAlertsSeen } from "@/lib/priceAlerts";

async function resolveIdentity() {
  const { userId } = await auth();
  return userId || (await getOrCreateGuestId());
}

export async function GET() {
  const identity = await resolveIdentity();
  try {
    const [watches, alerts, unseen] = await Promise.all([
      listWatchesForIdentity(identity),
      listAlertsForIdentity(identity),
      countUnseenAlerts(identity),
    ]);
    return Response.json({ watches, alerts, unseen });
  } catch (err) {
    console.error("Watchlist read failed:", err.message);
    return Response.json({ watches: [], alerts: [], unseen: 0 });
  }
}

export async function POST(req) {
  const identity = await resolveIdentity();
  const { listingId, targetPrice } = await req.json();
  if (!listingId || !Number.isFinite(Number(listingId))) {
    return Response.json({ error: "Missing listingId" }, { status: 400 });
  }
  try {
    const watch = await addWatch({
      identity,
      listingId: Number(listingId),
      targetPrice: targetPrice != null && targetPrice !== "" ? Number(targetPrice) : null,
    });
    return Response.json({ ok: true, watch });
  } catch (err) {
    console.error("Add watch failed:", err.message);
    return Response.json({ error: "Could not add to watchlist" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const identity = await resolveIdentity();
  const { searchParams } = new URL(req.url);
  const listingId = Number(searchParams.get("listingId"));
  if (!listingId) return Response.json({ error: "Missing listingId" }, { status: 400 });
  try {
    await removeWatch({ identity, listingId });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Remove watch failed:", err.message);
    return Response.json({ error: "Could not remove from watchlist" }, { status: 500 });
  }
}

// Marks all of this identity's alerts as seen — called once when the
// Alerts panel opens, so the header badge clears.
export async function PATCH() {
  const identity = await resolveIdentity();
  try {
    await markAlertsSeen(identity);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Mark alerts seen failed:", err.message);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
