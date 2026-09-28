// app/api/admin/migratephones-dryrun/route.js
//
// READ-ONLY report only — no write path exists in this file at all, on
// purpose (a follow-up route will handle the actual migration once this
// output is reviewed). Reuses lib/db.js's hashPhone the same way
// scripts/migrate-clerk-phones-to-india.mjs does, but as a Next.js route
// so it runs on Vercel with the real (unpullable) env vars, rather than
// needing them locally. See lib/phoneAuth.js's header comment for the
// RBI data-localization background.
//
// GET ?limit=N -> caps how many Clerk users are scanned.

import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { hashPhone } from "@/lib/db";

export const maxDuration = 60;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit")) || Infinity;

  const client = await clerkClient();
  const results = [];
  let offset = 0;
  let processed = 0;
  let wouldMigrate = 0;
  let skipped = 0;

  while (processed < limit) {
    const { data: batch } = await client.users.getUserList({ limit: 100, offset });
    if (!batch.length) break;
    for (const u of batch) {
      if (processed >= limit) break;
      processed++;
      const phone = u.phoneNumbers?.[0]?.phoneNumber;
      if (!phone) {
        skipped++;
        results.push({ clerkUserId: u.id, action: "skip", reason: "no phone number on file" });
        continue;
      }
      wouldMigrate++;
      results.push({
        clerkUserId: u.id,
        action: "would-migrate",
        phone: `...${phone.slice(-4)}`,
        phoneHashPreview: hashPhone(phone)?.slice(0, 12) + "…",
      });
    }
    offset += batch.length;
    if (batch.length < 100) break;
  }

  return Response.json({ processed, wouldMigrate, skipped, results });
}
