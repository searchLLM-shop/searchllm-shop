// app/api/admin/migratephones-live/route.js
//
// ONE-OFF cleanup, narrowly scoped: the earlier migration attempt for
// these two accounts (2026-09-28) successfully wrote user_identities
// rows before failing on the phone-deletion step (Clerk refused to
// delete their last identification even after a synthetic username was
// added). Both accounts have since been deleted directly in Clerk's
// dashboard (confirmed testers, no history worth keeping) — this now
// only deletes the resulting ORPHANED user_identities rows, which
// otherwise point at Clerk user ids that no longer exist. Left in place,
// either phone number returning to sign in later would hit this stale
// row and fail to mint a session with no recovery path.
//
// GET, admin-gated. Delete this route once run and confirmed.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { query } from "@/lib/db";

export const maxDuration = 30;

// Exactly these two — from the 2026-09-28 dry-run report, "...0815" and
// "...3055", both confirmed deleted in Clerk already.
const ORPHANED_CLERK_USER_IDS = ["user_3Jlt6Qu0hrLsW6g8g2qfLD5DI5j", "user_3Jg7zWdnNA28SCD4lF0HzC3LGKL"];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { rows } = await query(
    `DELETE FROM user_identities WHERE clerk_user_id = ANY($1) RETURNING clerk_user_id`,
    [ORPHANED_CLERK_USER_IDS]
  );

  return Response.json({ deleted: rows.map((r) => r.clerk_user_id) });
}
