// app/api/admin/testimonials/route.js
//
// Moderation queue for testimonials. Admin only.
//   GET                          -> every testimonial, pending first
//   POST {id, action}            -> action: approve | reject | unpublish | delete
// Approving is what puts one on the homepage.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { listAllTestimonials, moderateTestimonial, getDecryptedPhonesForUsers } from "@/lib/db";

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdminUser(await currentUser())) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

const maskPhone = (p) => (p ? `••••${String(p).replace(/\D/g, "").slice(-4)}` : null);

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const rows = await listAllTestimonials();
    const phones = await getDecryptedPhonesForUsers(rows.map((r) => r.userId));
    // The reviewer is identified by the last four digits of their mobile, so
    // a moderator can tell members apart without a full number on screen.
    return Response.json({
      testimonials: rows.map(({ userId, ...t }) => ({ ...t, member: maskPhone(phones.get(userId)) || userId.slice(0, 12) + "…" })),
    });
  } catch (err) {
    console.error("Admin testimonials failed:", err.message);
    return Response.json({ error: "Could not load testimonials" }, { status: 500 });
  }
}

export async function POST(req) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const ok = await moderateTestimonial(id, String(body.action || ""));
  return Response.json({ ok });
}
