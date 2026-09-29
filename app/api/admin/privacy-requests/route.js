// app/api/admin/privacy-requests/route.js
//
// Admin queue for DPDP data-principal requests (see schema.sql's
// privacy_requests comment). Fulfilment itself (compiling an export,
// deleting the user's rows across user_identities/points/redemptions/
// referrals/etc.) is a manual admin action, done directly against the
// DB the same way every other one-off admin action in this codebase
// has been — this route only tracks and resolves the REQUEST record.
//
// GET  -> all requests (pending first).
// POST {id, status: "fulfilled"|"rejected", note?} -> resolve one.

import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { getAllPrivacyRequests, resolvePrivacyRequest, getDecryptedPhoneForUser } from "@/lib/db";

async function isAdmin() {
  const user = await currentUser();
  return isAdminUser(user);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const requests = await getAllPrivacyRequests();
  // Resolve each requester to something a human can act on — same
  // phone-first, then Clerk-identity fallback pattern as the referrals/
  // vcommission-purchases admin reports.
  const client = await clerkClient();
  const withIdentity = await Promise.all(
    requests.map(async (r) => {
      let identity = await getDecryptedPhoneForUser(r.clerk_user_id);
      if (!identity) {
        try {
          const u = await client.users.getUser(r.clerk_user_id);
          identity = u.emailAddresses?.[0]?.emailAddress || u.username || r.clerk_user_id;
        } catch {
          identity = r.clerk_user_id;
        }
      }
      return { ...r, identity };
    })
  );
  return Response.json({ requests: withIdentity });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  if (!body?.id || !body?.status) return Response.json({ error: "Pass {id, status}" }, { status: 400 });

  const result = await resolvePrivacyRequest(body.id, body.status, body.note || null);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true });
}
