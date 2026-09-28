// scripts/migrate-clerk-phones-to-india.mjs
//
// ONE-OFF (2026-09-22, RBI data-localization fix — see schema.sql's
// user_identities comment, lib/phoneAuth.js). For each existing Clerk
// user: read their real phone number, write it into user_identities
// (encrypted, India-hosted), then strip the phone from the Clerk user
// record itself — the actual compliance fix for already-existing
// accounts. Run this ONLY after the new phone-OTP sign-in flow
// (app/api/auth/*, components/PhoneSignInButton.jsx) is deployed and
// verified live: an existing user's NEXT sign-in goes through that new
// flow, which looks up their pre-migrated phone_hash in user_identities
// and mints a session for their EXISTING clerk_user_id — so points/
// referral/redemption history (all keyed on Clerk user ID, which this
// script never changes) carries over exactly as before.
//
// Standalone .mjs, duplicating the tiny bit of lib/db.js/lib/piiCrypto.js
// logic it needs (same reason as scripts/import-vcommission-myntra.mjs:
// lib/db.js itself uses the "@/lib/..." path alias throughout, which only
// Next.js's own bundler resolves — unreachable from plain `node`).
//
// Usage:
//   DATABASE_URL=... CLERK_SECRET_KEY=... PII_ENCRYPTION_KEY=... \
//     node scripts/migrate-clerk-phones-to-india.mjs [--dry-run] [--limit=N]
//
// --dry-run: prints what WOULD happen (including the Clerk PATCH body)
//   without writing to Supabase or calling Clerk's PATCH endpoint.
//   ALWAYS run this first.
// --limit=N: only process the first N users (for a small tagged-test
//   pass against a couple of real accounts before running unbounded).

import pg from "pg";
import { createHash, createCipheriv, randomBytes } from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity;

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(1); }
if (!process.env.CLERK_SECRET_KEY) { console.error("CLERK_SECRET_KEY is required."); process.exit(1); }
if (!process.env.PII_ENCRYPTION_KEY) { console.error("PII_ENCRYPTION_KEY is required."); process.exit(1); }

// --- duplicated from lib/piiCrypto.js (same format, same algorithm) ---
function encryptPII(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const key = Buffer.from(process.env.PII_ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

// --- duplicated from lib/db.js's hashPhone (same salt env var, same normalization) ---
const PHONE_SALT = process.env.PHONE_HASH_SALT || "sllm-phone-identity-v1";
function hashPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!digits) return null;
  return createHash("sha256").update(PHONE_SALT + digits).digest("hex");
}

async function clerkFetch(path, options = {}) {
  const resp = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`Clerk ${options.method || "GET"} ${path} -> ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log(DRY_RUN ? "=== DRY RUN — no writes will happen ===" : "=== LIVE RUN ===");

  let offset = 0;
  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  while (processed < LIMIT) {
    const batch = await clerkFetch(`/users?limit=100&offset=${offset}`);
    if (!batch.length) break;
    for (const u of batch) {
      if (processed >= LIMIT) break;
      processed++;
      const phone = u.phone_numbers?.[0]?.phone_number;
      if (!phone) {
        console.log(`[skip] ${u.id} — no phone number on file already`);
        skipped++;
        continue;
      }
      const phoneHash = hashPhone(phone);
      console.log(`[migrate] ${u.id} — phone ...${phone.slice(-4)} -> user_identities, then stripping from Clerk`);
      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO user_identities (clerk_user_id, phone_encrypted, phone_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (clerk_user_id) DO NOTHING`,
          [u.id, encryptPII(phone), phoneHash]
        );
        // Strip the phone from Clerk — the actual compliance fix. Clerk
        // still needs SOME identifier; the user's existing username/email
        // (if any) or external_id stays, same as a freshly-created account.
        const phoneNumberId = u.phone_numbers?.[0]?.id;
        if (phoneNumberId) {
          await clerkFetch(`/phone_numbers/${phoneNumberId}`, { method: "DELETE" });
        }
      }
      migrated++;
    }
    offset += batch.length;
    if (batch.length < 100) break;
  }

  await pool.end();
  console.log(`\nDone. processed=${processed} migrated=${migrated} skipped=${skipped}${DRY_RUN ? " (dry run — nothing written)" : ""}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
