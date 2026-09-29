// app/api/admin/privacy-requests/export/route.js
//
// Compiles and downloads the actual data export a pending privacy_requests
// row asked for — the piece that was missing before (a status flag with
// nothing behind it). Bound to a real, existing request id rather than an
// arbitrary ?userId= param, so this can't be used to pull any account's
// data on a whim — only one that actually has an open or past request on
// file. Works for both request types: 'access' (the point of the export)
// and 'delete' (useful as an audit record of what existed right before
// deletion actually happens).
//
// GET ?requestId=<id> -> downloads a JSON file.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { query } from "@/lib/db";
import { compileUserDataExport } from "@/lib/privacyExport";

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const requestId = new URL(req.url).searchParams.get("requestId");
  if (!requestId) return Response.json({ error: "Pass ?requestId=" }, { status: 400 });

  const { rows } = await query(`SELECT clerk_user_id FROM privacy_requests WHERE id = $1`, [requestId]);
  if (!rows.length) return Response.json({ error: "No such request" }, { status: 404 });

  const data = await compileUserDataExport(rows[0].clerk_user_id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="user-data-request-${requestId}.json"`,
    },
  });
}
