// app/api/admin/listings/route.js
//
// Admin-only route for reviewing brand submissions. Access is gated by
// checking the signed-in user's email against ADMIN_EMAILS. Replace this
// with Clerk's organization roles or a proper roles table as the team
// grows — an env-var allowlist is fine for a single founder running review.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getPendingListings, setListingStatus } from "@/lib/db";

async function isAdmin() {
  const user = await currentUser();
  if (!user) return false;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const userEmail = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
  return adminEmails.includes(userEmail);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const pending = await getPendingListings();
  return Response.json({ pending });
}

export async function PATCH(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id, status } = await req.json();
  if (!id || !["approved", "rejected"].includes(status)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  await setListingStatus(id, status);
  return Response.json({ id, status });
}
