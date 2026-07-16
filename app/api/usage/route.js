// app/api/usage/route.js
//
// Lets the client show "X picks left" on page load, before the user has
// run any search this session — without this, the count would only ever
// update after a search completes, which reads wrong on first visit.

import { auth } from "@clerk/nextjs/server";
import { getUsageToday, getUserPlan } from "@/lib/db";
import { getOrCreateGuestId } from "@/lib/guestId";
import { PLANS } from "@/lib/constants";

export async function GET() {
  const { userId } = await auth();
  const identity = userId || (await getOrCreateGuestId());
  const plan = userId ? await getUserPlan(userId) : "free";
  const limit = PLANS[plan]?.searches ?? PLANS.free.searches;
  const used = limit === -1 ? 0 : await getUsageToday(identity);

  return Response.json({ plan, limit, used });
}
