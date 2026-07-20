// Admin: review advertisers, see what each one owes.
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAdvertisers, setAdvertiserStatus, getAllAdvertiserBilling } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

async function guard() {
  const { userId } = await auth();
  if (!userId) return "Not signed in";
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) return "Forbidden";
  return null;
}

export async function GET() {
  const err = await guard();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });
  const [advertisers, billing] = await Promise.all([getAdvertisers(), getAllAdvertiserBilling()]);
  return Response.json({ advertisers, billing });
}

export async function PATCH(req) {
  const err = await guard();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });
  const { id, status } = await req.json();
  if (!["approved", "rejected", "paused", "pending"].includes(status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }
  await setAdvertiserStatus(id, status);
  return Response.json({ id, status });
}
