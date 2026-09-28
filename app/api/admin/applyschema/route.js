// app/api/admin/applyschema/route.js
//
// ONE-OFF: applies the user_identities/phone_otp_sends tables from
// schema.sql directly to production (schema.sql itself is never
// auto-applied — same pattern used for every schema change this session,
// e.g. referral_codes/referrals). Idempotent (IF NOT EXISTS throughout)
// — safe to call more than once. Delete this route once confirmed
// applied.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { query } from "@/lib/db";

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const statements = [
    `CREATE TABLE IF NOT EXISTS user_identities (
       clerk_user_id TEXT PRIMARY KEY,
       phone_encrypted TEXT NOT NULL,
       phone_hash TEXT NOT NULL UNIQUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_user_identities_phone_hash ON user_identities (phone_hash)`,
    `CREATE TABLE IF NOT EXISTS phone_otp_sends (
       id SERIAL PRIMARY KEY,
       phone_hash TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_phone_otp_sends_phone_hash ON phone_otp_sends (phone_hash, created_at DESC)`,
    `ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE phone_otp_sends ENABLE ROW LEVEL SECURITY`,
  ];

  const results = [];
  for (const sql of statements) {
    try {
      await query(sql);
      results.push({ sql: sql.split("\n")[0].trim(), ok: true });
    } catch (err) {
      results.push({ sql: sql.split("\n")[0].trim(), ok: false, error: String(err?.message || err) });
    }
  }
  return Response.json({ results });
}
