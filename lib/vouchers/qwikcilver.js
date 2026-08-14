// lib/vouchers/qwikcilver.js
//
// Automated gift-voucher issuance via Pine Labs' Qwikcilver platform —
// replaces the fully-manual "admin buys the voucher, pastes the code" flow
// in app/api/admin/redemptions/route.js for whichever brands/denominations
// this ends up covering.
//
// STATUS: honestly incomplete, the same way lib/feeds/vcommission.js was
// before vCommission's real feed spec existed. Pine Labs publishes only
// marketing-level category names for their partner APIs (Account
// Management, Wallet, Distribution, Prepaid Network Card, KYC Management)
// at developers.qwikcilver.com — the actual technical reference (real
// endpoint paths, auth scheme, request/response field names) sits behind
// a "Schedule A Demo" / partner-onboarding flow, not self-serve docs. This
// file is NOT going to guess at that shape for something that issues real
// monetary value. It defines the exact contract the rest of the app needs
// (issueVoucher / isConfigured, same idea as fetchVcommissionFeed's
// normalized-shape contract) and does the parts that ARE knowable today —
// env-var wiring and the QuotaGuard static-IP proxy plumbing Pine Labs
// will need for IP allowlisting — so that once real credentials and a
// technical spec exist, filling in buildIssuanceRequest() is a contained,
// well-scoped task instead of a rebuild.
//
// What to ask the Pine Labs/Qwikcilver account manager for, once assigned:
//   1. Which API (of the five categories above) actually issues a
//      single-use voucher code for a given brand + denomination — almost
//      certainly "Distribution API", but confirm.
//   2. Auth scheme — API key header? OAuth2 client-credentials? HMAC
//      request signing (common on Qwikcilver's merchant-facing docs for
//      other integrations)? Needed before QWIKCILVER_API_KEY below means
//      anything concrete.
//   3. The real base URL (sandbox and production are typically separate
//      hosts on these platforms).
//   4. Their brand/SKU catalog — our LOYALTY.VOUCHER_CATALOG brand names
//      (lib/constants.js: "Amazon Pay", "Flipkart", "Myntra", ...) need
//      mapping to whatever product/SKU codes Qwikcilver uses internally.
//      BRAND_SKU_MAP below is intentionally empty until that catalog is
//      in hand — do not guess codes.
//   5. Confirmation that our two QuotaGuard static IPs (see below) are
//      what they want allowlisted, vs. a different mechanism (mTLS, VPN).

import { ProxyAgent } from "undici";

// --- Proxy plumbing (real, not a stub) ------------------------------------
//
// Pine Labs, like most B2B financial-services APIs, is expected to require
// IP allowlisting. Vercel serverless functions don't have a stable outbound
// IP by default, so outbound calls to Qwikcilver are routed through
// QuotaGuard Static's load-balanced IP pair. Set QUOTAGUARDSTATIC_URL
// (from the QuotaGuard dashboard, format
// http://user:pass@static-x.quotaguard.com:9293) as a Vercel env var, and
// give QuotaGuard's two static IPs to the Pine Labs account manager to
// allowlist. Locally, with QUOTAGUARDSTATIC_URL unset, calls just go out
// direct — fine for hitting a sandbox that doesn't enforce allowlisting.
let cachedAgent;
function proxyAgent() {
  const proxyUrl = process.env.QUOTAGUARDSTATIC_URL;
  if (!proxyUrl) return null;
  if (!cachedAgent) cachedAgent = new ProxyAgent(proxyUrl);
  return cachedAgent;
}

async function proxyFetch(url, opts = {}) {
  const dispatcher = proxyAgent();
  return fetch(url, dispatcher ? { ...opts, dispatcher } : opts);
}

// --- Configuration ----------------------------------------------------
//
// Everything here is a real env var, but QWIKCILVER_API_KEY /
// QWIKCILVER_API_BASE are placeholders until the account manager confirms
// the real auth scheme (see note 2 above) — treat the names as reserved,
// not verified against a working call.
export function isConfigured() {
  return Boolean(
    process.env.QWIKCILVER_API_KEY &&
    process.env.QWIKCILVER_API_BASE &&
    Object.keys(BRAND_SKU_MAP).length > 0
  );
}

// Our voucher_type (see LOYALTY.VOUCHER_CATALOG in lib/constants.js) ->
// Qwikcilver's own product/SKU code. Left empty on purpose — see note 4
// above. Fill in once their catalog is available, e.g.:
//   { "Amazon Pay": "QC-AMZ-IN", "Flipkart": "QC-FLPKT-IN" }
const BRAND_SKU_MAP = {};

// Deliberately throws rather than returning a guessed shape — every field
// name here would be fabricated. Once the real spec is in hand, replace
// the throw with the actual signed/authenticated request Pine Labs expects
// and return { url, options } for proxyFetch to send.
function buildIssuanceRequest({ sku, denomination, redemptionId }) {
  throw new Error(
    "Qwikcilver request format not yet specified — see the notes at the " +
    "top of lib/vouchers/qwikcilver.js for what to get from Pine Labs " +
    "before implementing this."
  );
}

// The normalized contract the rest of the app depends on. Never throws —
// mirrors extractIntent()/generateClarifyingQuestions()'s "fail soft,
// caller falls back" pattern, since the caller here is the admin
// redemption queue and the fallback (manual code entry) already exists
// and must keep working regardless of what this function does.
//
// Returns one of:
//   { ok: true,  voucherCode, raw }
//   { ok: false, reason }   // reason is shown to the admin, not the shopper
export async function issueVoucher({ brand, denomination, redemptionId }) {
  if (!process.env.QWIKCILVER_API_KEY || !process.env.QWIKCILVER_API_BASE) {
    return { ok: false, reason: "Qwikcilver not configured (QWIKCILVER_API_KEY/QWIKCILVER_API_BASE unset) — fulfil manually." };
  }
  const sku = BRAND_SKU_MAP[brand];
  if (!sku) {
    return { ok: false, reason: `No Qwikcilver SKU mapped for "${brand}" — add it to BRAND_SKU_MAP once Pine Labs shares their catalog. Fulfil manually.` };
  }

  let request;
  try {
    request = buildIssuanceRequest({ sku, denomination, redemptionId });
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }

  try {
    const resp = await proxyFetch(request.url, request.options);
    if (!resp.ok) {
      return { ok: false, reason: `Qwikcilver API error: ${resp.status} ${await resp.text().catch(() => "")}` };
    }
    const data = await resp.json();
    // Field name is a placeholder — correct once the real response shape
    // is known (note 1/2 above).
    const voucherCode = data?.voucherCode || data?.card_number || null;
    if (!voucherCode) return { ok: false, reason: "Qwikcilver responded but no voucher code was found in the response." };
    return { ok: true, voucherCode, raw: data };
  } catch (err) {
    return { ok: false, reason: `Qwikcilver request failed: ${String(err?.message || err)}` };
  }
}
