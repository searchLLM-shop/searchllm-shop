// Free-retry tickets for the research stream.
//
// A search spends one of the shopper's daily picks the moment it starts. If
// the answer never reaches the browser — a network stall, or the server
// failing partway — the shopper shouldn't pay twice to see it. The server
// refunds the pick itself when IT detects the failure, but it cannot know
// when the answer was generated fine and simply never arrived, so the
// stream's first line hands the client a short-lived ticket. A retry of the
// SAME query that presents a valid ticket skips the pick charge (and the
// search-points credit, so a retry can never earn twice).
//
// Stateless: an HMAC over identity + query hash + expiry. Bound to the
// identity and the exact query text, valid for a few minutes, so the most a
// leaked or replayed ticket buys is re-running that one query briefly.

import crypto from "crypto";

const TTL_MS = 5 * 60 * 1000;

function secret() {
  // PHONE_HASH_SALT is set in production; IP_HASH_SALT is the fallback.
  const base = process.env.PHONE_HASH_SALT || process.env.IP_HASH_SALT || "";
  return base ? crypto.createHash("sha256").update(`retry-ticket|${base}`).digest() : null;
}

const queryKey = (query) => crypto.createHash("sha256").update(String(query || "").trim().toLowerCase()).digest("hex").slice(0, 16);

function mac(key, payload) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueRetryTicket(identity, query) {
  const key = secret();
  if (!key || !identity) return null;
  const payload = `${identity}|${queryKey(query)}|${Date.now() + TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${mac(key, payload)}`;
}

export function verifyRetryTicket(ticket, identity, query) {
  const key = secret();
  if (!key || !identity || typeof ticket !== "string" || ticket.length > 400) return false;
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return false;
  let payload;
  try { payload = Buffer.from(body, "base64url").toString("utf8"); } catch { return false; }
  const expected = mac(key, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const [tIdentity, tQuery, tExp] = payload.split("|");
  return tIdentity === String(identity) && tQuery === queryKey(query) && Number(tExp) > Date.now();
}
