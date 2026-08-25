// app/api/usage/route.js
//
// Powers the header: picks left and the points chip. ONE database query
// (consolidated 2026-07-27, was three) — plan, today's usage and the
// points balance resolve together, and guest day-points need no query at
// all since they're today's pick count times the per-pick rate.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getHeaderSnapshot } from "@/lib/db";
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

  const points = userId
    ? { kind: "user", balance: snapshot.balance, pending: snapshot.pending }
    : { kind: "guest", today: snapshot.used * LOYALTY.POINTS.GUEST_PER_PICK };

  return Response.json({ plan, limit, used: limit === -1 ? 0 : snapshot.used, points });
}
