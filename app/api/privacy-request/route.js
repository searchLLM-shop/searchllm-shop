// app/api/privacy-request/route.js
//
// Self-service, tracked version of Privacy Policy section 8's rights
// (access/correction/deletion) — DPDP Act, 2023 data-principal requests.
// The email path (deploy@pibitsai.com) still works too; this just gives
// a real record instead of relying on an inbox.
//
// GET  -> the signed-in user's own request history.
// POST {type: "access"|"delete"} -> opens a new request.

import { auth } from "@clerk/nextjs/server";
import { createPrivacyRequest, getPrivacyRequestsForUser } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const requests = await getPrivacyRequestsForUser(userId);
  return Response.json({ requests });
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const result = await createPrivacyRequest(userId, body?.type);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true });
}
