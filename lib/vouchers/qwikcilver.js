// lib/vouchers/qwikcilver.js
//
// Automated gift-voucher issuance via Pine Labs' Qwikcilver platform
// ("QwikGiftAPI"), replacing the fully-manual "admin buys the voucher,
// pastes the code" flow in app/api/admin/redemptions/route.js.
//
// Built against the real, self-serve technical docs at
// developers.woohoo.in (REST API V3) — OAuth 2.0 flow, request signing,
// and the Order API request/response shapes below are all taken directly
// from that spec, not guessed. Two things are NOT knowable without a live
// account, though, and are left as clearly-marked gaps rather than
// invented:
//   1. Real credentials (QWIKCILVER_CLIENT_ID/SECRET/USERNAME/PASSWORD) —
//      obviously can't exist until Pine Labs provisions an account.
//   2. The SKU for each of our voucher brands (LOYALTY.VOUCHER_CATALOG in
//      lib/constants.js: "Amazon Pay", "Flipkart", ...) — Qwikcilver's
//      catalog is account-specific, so BRAND_SKU_MAP below starts empty.
//      Use the getCategories()/getProduct() helpers below (wired into
//      app/api/admin/qwikcilverdiag/route.js, same diagnostic-first
//      pattern as /api/admin/feeddiag) to browse the real sandbox catalog
//      and fill it in once credentials exist.
//
// Reference: https://developers.woohoo.in/docs/rest-api-v3-revamp/ and
// https://developers.woohoo.in/docs/get-started-title/oauth-2-0-protocol-recommended/

import { createHmac } from "node:crypto";
import { ProxyAgent } from "undici";

// --- Proxy plumbing ---------------------------------------------------
//
// Pine Labs' partner APIs are expected to require IP allowlisting (B2B
// financial APIs typically do; confirm with the account manager once
// assigned). Vercel serverless functions don't have a stable outbound IP
// by default, so calls are routed through QuotaGuard Static's
// load-balanced IP pair. Set QUOTAGUARDSTATIC_URL (from the QuotaGuard
// dashboard) as a Vercel env var and give their two static IPs to Pine
// Labs to allowlist. Locally, with QUOTAGUARDSTATIC_URL unset, calls just
// go out direct — fine against the sandbox.
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

// --- Our voucher_type -> Qwikcilver SKU ------------------------------
//
// See note 2 above. Fill in once the real catalog is available, e.g.:
//   { "Amazon Pay": "GCGBAMZN001", "Flipkart": "EGCGBFLPKT001" }
const BRAND_SKU_MAP = {};

export function isConfigured() {
  return Boolean(
    process.env.QWIKCILVER_CLIENT_ID &&
    process.env.QWIKCILVER_CLIENT_SECRET &&
    process.env.QWIKCILVER_USERNAME &&
    process.env.QWIKCILVER_PASSWORD &&
    Object.keys(BRAND_SKU_MAP).length > 0
  );
}

// --- OAuth 2.0 (developers.woohoo.in/docs/get-started-title/oauth-2-0-protocol-recommended) ---
//
// Two-step: POST /oauth2/verify with clientId+username+password gets an
// authorizationCode; POST /oauth2/token with clientId+clientSecret+that
// code gets the Bearer token. Token is valid one week — cached in-memory
// here (a cold serverless invocation just re-fetches, which is fine at
// this call volume).
let cachedToken = null; // { token, expiresAt }

async function getBearerToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const oauthBase = process.env.QWIKCILVER_OAUTH_BASE || "https://sandbox.woohoo.in";

  const verifyResp = await proxyFetch(`${oauthBase}/oauth2/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.QWIKCILVER_CLIENT_ID,
      username: process.env.QWIKCILVER_USERNAME,
      password: process.env.QWIKCILVER_PASSWORD,
    }),
  });
  if (!verifyResp.ok) {
    throw new Error(`oauth2/verify failed: ${verifyResp.status} ${await verifyResp.text().catch(() => "")}`);
  }
  const { authorizationCode } = await verifyResp.json();
  if (!authorizationCode) throw new Error("oauth2/verify returned no authorizationCode");

  const tokenResp = await proxyFetch(`${oauthBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.QWIKCILVER_CLIENT_ID,
      clientSecret: process.env.QWIKCILVER_CLIENT_SECRET,
      authorizationCode,
    }),
  });
  if (!tokenResp.ok) {
    throw new Error(`oauth2/token failed: ${tokenResp.status} ${await tokenResp.text().catch(() => "")}`);
  }
  const { token } = await tokenResp.json();
  if (!token) throw new Error("oauth2/token returned no token");

  // Cache a day under the documented 1-week expiry as a safety margin.
  cachedToken = { token, expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000 };
  return token;
}

// --- Request signing (OAuth2.0 Signature Generation Steps for Request) --
//
// A = method, C = RFC3986-encoded full URL (with sorted query params),
// D = "A&C", F = RFC3986-encoded JSON body with keys sorted recursively,
// G = "D&F". Signature = HMAC-SHA512(hex) of D (GET, no body) or G (POST
// with body), keyed on the client secret.
function rfc3986Encode(str) {
  // encodeURIComponent leaves !'()* unescaped; RFC3986 wants them escaped too.
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortKeysDeep(value[k]);
      return acc;
    }, {});
  }
  return value;
}

function sortedUrlString(url) {
  const u = new URL(url);
  const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  const base = u.toString();
  return params.length ? `${base}?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : base;
}

function buildSignature({ method, url, body, clientSecret }) {
  const A = method.toUpperCase();
  const C = rfc3986Encode(sortedUrlString(url));
  let base = `${A}&${C}`;
  if (body !== undefined && body !== null) {
    const F = rfc3986Encode(JSON.stringify(sortKeysDeep(body)));
    base = `${base}&${F}`;
  }
  return createHmac("sha512", clientSecret).update(base).digest("hex");
}

// A signed, authenticated call to any QwikGiftAPI v3 endpoint. Returns the
// raw Response — callers decide how to interpret status/body, since the
// same helper backs both the issuance call and the read-only catalog
// helpers used by the admin diagnostic route.
async function qcRequest(method, path, body) {
  const apiBase = process.env.QWIKCILVER_API_BASE || "https://sandbox.woohoo.in/rest";
  const url = `${apiBase}${path}`;
  const token = await getBearerToken();
  const dateAtClient = new Date().toISOString();
  const signature = buildSignature({ method, url, body, clientSecret: process.env.QWIKCILVER_CLIENT_SECRET });
  return proxyFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      Authorization: `Bearer ${token}`,
      dateAtClient,
      signature,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// --- Catalog helpers (read-only) ---------------------------------------
//
// Used by app/api/admin/qwikcilverdiag/route.js so BRAND_SKU_MAP can be
// filled in from what the account actually contains, instead of guessed.
export async function getCategories(id) {
  const resp = await qcRequest("GET", `/v3/catalog/categories${id ? `/${id}` : ""}`);
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

export async function listCategoryProducts(categoryId, { offset = 0, limit = 100 } = {}) {
  const resp = await qcRequest("GET", `/v3/catalog/categories/${categoryId}/products?offset=${offset}&limit=${limit}`);
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

export async function getProduct(sku) {
  const resp = await qcRequest("GET", `/v3/catalog/products/${encodeURIComponent(sku)}`);
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

// --- Issuance ------------------------------------------------------------
//
// "Billing" here is OUR business's own contact details, not the member's
// — the Order API requires a billing party regardless of delivery mode,
// but since deliveryMode:"API" returns the card in the response body
// (nothing is emailed/texted to anyone by Qwikcilver), the member's
// personal details never need to leave our own database for this call.
// Set these to your real registered business contact info.
function billingFromEnv() {
  return {
    firstname: process.env.QWIKCILVER_BILLING_NAME || "",
    email: process.env.QWIKCILVER_BILLING_EMAIL || "",
    telephone: process.env.QWIKCILVER_BILLING_PHONE || "",
    line1: process.env.QWIKCILVER_BILLING_LINE1 || "",
    city: process.env.QWIKCILVER_BILLING_CITY || "",
    region: process.env.QWIKCILVER_BILLING_REGION || "",
    country: process.env.QWIKCILVER_BILLING_COUNTRY || "IN",
    postcode: process.env.QWIKCILVER_BILLING_POSTCODE || "",
  };
}

// The normalized contract the rest of the app depends on. Never throws —
// mirrors extractIntent()/generateClarifyingQuestions()'s "fail soft,
// caller falls back" pattern: the caller is the admin redemption queue,
// and manual code entry must keep working regardless of what this does.
//
// Returns { ok: true, voucherCode, raw } or { ok: false, reason }.
// `reason` is shown to the admin, never the shopper.
export async function issueVoucher({ brand, denomination, redemptionId }) {
  if (!process.env.QWIKCILVER_CLIENT_ID || !process.env.QWIKCILVER_CLIENT_SECRET ||
      !process.env.QWIKCILVER_USERNAME || !process.env.QWIKCILVER_PASSWORD) {
    return { ok: false, reason: "Qwikcilver credentials not configured (QWIKCILVER_CLIENT_ID/SECRET/USERNAME/PASSWORD) — fulfil manually." };
  }
  const sku = BRAND_SKU_MAP[brand];
  if (!sku) {
    return { ok: false, reason: `No Qwikcilver SKU mapped for "${brand}" — look it up via /api/admin/qwikcilverdiag and add it to BRAND_SKU_MAP. Fulfil manually.` };
  }

  const billing = billingFromEnv();
  if (!billing.firstname || !billing.email || !billing.telephone || !billing.line1 || !billing.city || !billing.region || !billing.postcode) {
    return { ok: false, reason: "Qwikcilver billing details incomplete — set QWIKCILVER_BILLING_* env vars (your own business contact info). Fulfil manually." };
  }

  // Deterministic, not timestamped: a retried call for the same
  // redemption reuses the same refno, so a genuine duplicate submit is
  // rejected by Qwikcilver (code 5313) instead of silently issuing a
  // second voucher for the same redemption.
  const refno = `sllm-redemption-${redemptionId}`;

  const body = {
    billing,
    address: { ...billing, billToThis: true },
    payments: [{ code: "svc", amount: denomination, mode: "ANY" }],
    refno,
    remarks: `SearchLLM redemption #${redemptionId}`,
    deliveryMode: "API", // card details come back in this response, nothing emailed/texted by Qwikcilver
    orderMode: "SELF",
    syncOnly: true, // get the card back synchronously (max qty 4/request — fine, qty is always 1 here)
    products: [{ sku, price: denomination, qty: 1, currency: 356 }], // 356 = INR numeric currency code
  };

  let resp;
  try {
    resp = await qcRequest("POST", "/v3/orders", body);
  } catch (err) {
    return { ok: false, reason: `Qwikcilver request failed: ${String(err?.message || err)}` };
  }

  const data = await resp.json().catch(() => null);

  if (resp.status === 201 && data?.cards?.[0]?.cardNumber) {
    const card = data.cards[0];
    const voucherCode = card.cardPin ? `${card.cardNumber} / PIN ${card.cardPin}` : card.cardNumber;
    return { ok: true, voucherCode, raw: data };
  }
  if (resp.status === 202) {
    // Async even though syncOnly:true was requested — Qwikcilver's docs
    // allow for this. Card details need a follow-up Activated Cards API
    // call once status turns COMPLETE; not worth building until it's
    // actually observed happening, since sync mode should avoid it.
    return { ok: false, reason: `Qwikcilver accepted the order asynchronously (orderId ${data?.orderId || "?"}, refno ${refno}) instead of returning the card immediately. Check the Order Status API for this refno once complete, then fulfil manually with the code.` };
  }
  if (data?.code === 5313) {
    return { ok: false, reason: `An order for this redemption (refno ${refno}) may already exist at Qwikcilver — check the Order Details API before retrying, to avoid double-issuing.` };
  }
  return { ok: false, reason: `Qwikcilver order failed: ${data?.message || resp.statusText || resp.status} (code ${data?.code ?? "n/a"})` };
}
