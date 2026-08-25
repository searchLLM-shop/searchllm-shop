// app/api/usage/route.js
//
// Powers the header: picks left and the points chip. Plan/usage/balance
// resolve from one query (consolidated 2026-07-27) for signed-in users;
// guest day-points (redesigned 2026-08-25 to also cover click/purchase
// points, not just search) need their own query — see getGuestDayPoints.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getHeaderSnapshot, getGuestDayPoints } from "@/lib/db";
import { getOrCreateGuestId } from "@/lib/guestId";
import { PLANS, LOYALTY, dailyPickLimit } from "@/lib/constants";
import { isAdminEmail } from "@/lib/isAdmin";

export async function GET() {
  const { userId } = await auth();
  const identity = userId || (await getOrCreateGuestId());
  const admin = isAdminEmail((userId ? await currentUser() : null)?.emailAddresses?.[0]?.emailAddress);

  let snapshot;
  try {
    snapshot = await getHeaderSnapshot(identity, userId);
  } catch (err) {
    console.error("Header snapshot failed:", err.message);
    return Response.json({ plan: "free", limit: PLANS.free.searches, used: 0, points: null });
  }

  const plan = admin ? "plus" : snapshot.plan;
  const limit = dailyPickLimit({
    signedIn: Boolean(userId),
    plan,
    isAdmin: admin,
  });

  let points;
  if (userId) {
    // capped: a non-Plus member has hit the earning ceiling — this is what
    // drives the homepage "upgrade to keep earning" banner, shown every
    // time they open the app until they do (or a plan check flips it off).
    const capped = plan !== "plus" && snapshot.totalPoints >= LOYALTY.VOUCHER_UNLOCK_POINTS;
    points = {
      kind: "user",
      balance: snapshot.balance,
      pending: snapshot.pending,
      totalPoints: snapshot.totalPoints,
      unlockAt: LOYALTY.VOUCHER_UNLOCK_POINTS,
      capped,
      canClaimVoucher: snapshot.totalPoints >= LOYALTY.VOUCHER_UNLOCK_POINTS,
    };
  } else {
    let guestToday = 0;
    try { guestToday = await getGuestDayPoints(identity); } catch (err) { console.error("Guest points failed:", err.message); }
    points = { kind: "guest", today: guestToday };
  }

  return Response.json({ plan, limit, used: limit === -1 ? 0 : snapshot.used, points });
}
