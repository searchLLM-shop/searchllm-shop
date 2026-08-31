// lib/piiCrypto.js
//
// Column-level encryption for PII at rest (added 2026-08-25, following the
// security review). Disk-level encryption (Supabase's default) protects
// against physical/backup theft; it does NOT protect PII from anyone who
// simply holds valid DB credentials — a leaked DATABASE_URL, a Supabase-
// side incident, or a misconfiguration. This closes that specific gap for
// the RBI KYC fields (name, mobile, email, address) by encrypting them in
// the application layer, BEFORE they ever reach Postgres — the ciphertext
// is all the database, its logs, and its backups ever see.
//
// Deliberately NOT done via Postgres's pgcrypto: that would mean passing
// the encryption key to Postgres as a query parameter on every read/write,
// which risks the key itself ending up in Supabase's own query logs —
// worse than the problem being solved. Keeping both the key and the
// encrypt/decrypt operations inside the Node process means the key never
// leaves this application's trust boundary (the same boundary DATABASE_URL
// and every other secret already lives in).
//
// AES-256-GCM: authenticated encryption — a tampered or truncated
// ciphertext fails to decrypt outright (the auth tag won't verify) rather
// than silently returning garbage. A fresh random IV per value (GCM
// requires a unique IV per encryption; reusing one under the same key is
// a real cryptographic break, not just bad practice) means the same
// plaintext never produces the same ciphertext twice, which also means
// these columns can never be searched/matched at the SQL level — nothing
// in this app currently needs that (no "find redemption by email" feature
// exists), but it's a real, permanent tradeoff worth knowing about.
//
// Stored format: "v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>" — versioned
// so a future key rotation can support decrypting old values under an old
// key while encrypting new ones under a new key, without a flag day.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the GCM-recommended size
const VERSION = "v1";

function getKey() {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set — required to store or read encrypted PII. " +
      "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and set it in Vercel."
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be 64 hex characters (32 bytes) for AES-256.");
  }
  return key;
}

// Encrypts a plaintext string for storage. Returns null for null/undefined/
// empty input (so an optional field stays optional — no ciphertext for
// "nothing was provided"), never throws on that path.
export function encryptPII(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

// Decrypts a value produced by encryptPII. Returns null for null/empty
// input. On any failure (wrong key, corrupted value, or — importantly — a
// value that was never actually encrypted, e.g. old plaintext rows from
// before this change) it returns a clearly-marked placeholder and logs the
// error, rather than throwing and taking down whatever page called it —
// a rewards summary or an admin queue must never 500 because of one bad
// row when 99 others are fine.
export function decryptPII(stored) {
  if (stored == null || stored === "") return null;
  const parts = String(stored).split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    // Not our format at all — most likely a legacy plaintext value written
    // before encryption was added. Return it as-is rather than mangling it;
    // callers that need to distinguish can check for the "v1:" prefix.
    return stored;
  }
  try {
    const key = getKey();
    const [, ivB64, authTagB64, ciphertextB64] = parts;
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("PII decryption failed (wrong key, or corrupted value):", err.message);
    return "[decryption failed]";
  }
}
