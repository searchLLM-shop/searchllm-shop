// app/api/admin/migratephones-live/route.js
//
// ONE-OFF, narrowly scoped: migrates exactly the two specific
// pre-existing Clerk accounts identified via
// /api/admin/migratephones-dryrun's report on 2026-09-28 — hardcoded
// below, not parameterized, and not a loop over all Clerk users. (The
// third candidate that dry-run found, the admin's own old duplicate
// account, was deleted directly via Clerk's dashboard instead — see
// project memory.)
//
// For each: writes its real phone into user_identities (encrypted,
// India-hosted) if not already present, then strips the phone number
// from the Clerk user record itself — the actual compliance fix. See
// lib/phoneAuth.js's header comment for the full RBI data-localization
// story.
//
// GET, admin-gated. Delete this route once run and confirmed.

import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { hashPhone, query } from "@/lib/db";
import { encryptPII } from "@/lib/piiCrypto";

export const maxDuration = 30;

// Exactly these two — from the 2026-09-28 dry-run report, "...0815" and
// "...3055".
const TARGET_CLERK_USER_IDS = ["user_3Jlt6Qu0hrLsW6g8g2qfLD5DI5j", "user_3Jg7zWdnNA28SCD4lF0HzC3LGKL"];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const client = await clerkClient();
  const results = [];

  for (const targetId of TARGET_CLERK_USER_IDS) {
    try {
      const u = await client.users.getUser(targetId);
      const phone = u.phoneNumbers?.[0]?.phoneNumber;
      if (!phone) {
        results.push({ clerkUserId: targetId, action: "skip", reason: "no phone number on file" });
        continue;
      }
      await query(
        `INSERT INTO user_identities (clerk_user_id, phone_encrypted, phone_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (clerk_user_id) DO NOTHING`,
        [targetId, encryptPII(phone), hashPhone(phone)]
      );
      const phoneNumberId = u.phoneNumbers?.[0]?.id;
      if (phoneNumberId) {
        await client.phoneNumbers.deletePhoneNumber(phoneNumberId);
      }
      results.push({ clerkUserId: targetId, action: "migrated", phone: `...${phone.slice(-4)}` });
    } catch (err) {
      results.push({ clerkUserId: targetId, action: "error", error: String(err?.message || err) });
    }
  }

  return Response.json({ results });
}
