// app/api/usage/route.js
//
// Powers the header: picks left and the points chip. Usage/balance resolve
// from one query (consolidated 2026-07-27) for signed-in users; guest
// day-points need their own query — see getGuestDayPoints. No plan tier
// (2026-08-25): the header's "capped" state now reflects the flat
// platform-fee block ceiling, the same for every account.

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
    return Response.json({ limit: PLANS.free.searches, used: 0, points: null });
  }

  const limit = dailyPickLimit({
    signedIn: Boolean(userId),
    isAdmin: admin,
  });

  let points;
  if (userId) {
    // atCeiling: earning has paused at this account's current block
    // boundary — this is what drives the homepage "pay the platform fee"
    // banner, shown every time they open the app until they pay.
    points = {
      kind: "user",
      balance: snapshot.balance,
      pending: snapshot.pending,
      totalPoints: snapshot.totalPoints,
      ceiling: snapshot.ceiling,
      atCeiling: snapshot.atCeiling,
      platformFeeInr: LOYALTY.PLATFORM_FEE_INR,
    };
  } else {
    let guestToday = 0;
    try { guestToday = await getGuestDayPoints(identity); } catch (err) { console.error("Guest points failed:", err.message); }
    points = { kind: "guest", today: guestToday };
  }

  return Response.json({ limit, used: limit === -1 ? 0 : snapshot.used, points });
}
