// lib/vouchers/qwikcilver.js
//
// Automated gift-voucher issuance via Pine Labs' Qwikcilver platform
// ("QwikGiftAPI"), replacing the fully-manual "admin buys the voucher,
// pastes the code" flow in app/api/admin/redemptions/route.js.
//
// REVISED 2026-09-07/08 against the real sandbox onboarding kit (Postman
// collection + environment + UAT test-kit spreadsheet, sent directly by
// Qwikcilver's team) and, when that wasn't enough, their own live support
// engineer reproducing a working order on this exact account — several
// real bugs found along the way, each noted at the fix site:
//   1. The Order endpoint is /v3/orders (PLURAL). An earlier pass here
//      briefly "corrected" this to /v3/order (singular) based on one
//      sample in the sandbox kit's Postman collection — that was wrong,
//      confirmed 2026-09-08 by Qwikcilver's own support engineer
//      reproducing a real, working order against /v3/orders on this same
//      account. The wrong path didn't 404 — it landed on generic auth
//      middleware that reports oauth_problem=signature_invalid for any
//      failed/unmatched request, which is what made this look like a
//      signing bug for a long stretch of debugging before the real cause
//      (wrong path) was found.
//   2. The signature's URL/body encoding is plain encodeURIComponent, not
//      strict RFC3986 — the vendor's own Postman test script (which
//      verifies the server's returned signature against a client-side
//      recomputation) settles this authoritatively. (The public prose
//      docs do say RFC3986 by name, but for every payload actually sent
//      here — no `!'()*` characters anywhere — the two encodings produce
//      identical output, so this was never actually the differentiator.)
//   3. The Order body only carries the fields their real sample shows —
//      `payments[].mode` and a top-level `orderMode` aren't part of the
//      real schema and are dropped.
//   4. The signature must be computed over the EXACT bytes sent as the
//      request body — an earlier version signed a sort-keyed version of
//      the body but then sent the original, unsorted one. Every GET call
//      (no body) passed regardless, since that branch never touched the
//      body at all; only a real POST surfaced it. Fixed by deriving the
//      sorted, stringified body once in qcRequest and using that same
//      string for both the signature and the actual request body. (This
//      fix was necessary and correct, but on its own wasn't sufficient —
//      #1 above was the actual remaining cause of signature_invalid.)
//   5. Even after #1-#4, /v3/orders STILL returned signature_invalid on
//      every real POST — a separate, still-then-unresolved saga (see the
//      detailed writeup in searchllm-shop project memory if picking this
//      up later). 2026-09-10: Qwikcilver sent a raw cURL of an order they
//      say they ran successfully using our exact Client Key. Diffed
//      field-for-field against our body: their working request has NO
//      `remarks`, `deliveryMode`, or `syncOnly` fields — all three were
//      dropped here to match. Since the signature covers the whole body,
//      any field outside their real schema is a plausible reason every
//      POST failed while every field-free GET always passed (if their
//      server strips unrecognized fields before re-verifying the
//      signature, our extra fields alone would desync the two). NOT YET
//      CONFIRMED this alone fixes it — re-test via testOrder() before
//      assuming so. `debug.consumerId` (decoded from our own Bearer JWT,
//      added the same day) is there to settle a second open question:
//      whether the OAuth step is genuinely authenticating as our account
//      at all, since Qwikcilver's "working" example's billing details
//      still read "Shreya" (their internal test user) — compare it
//      against whatever consumerId a decode of THEIR example JWT shows.
//
// Two things are still NOT knowable without further catalog/account
// setup, and are left as clearly-marked gaps rather than invented:
//   1. Real credentials (QWIKCILVER_CLIENT_ID/SECRET/USERNAME/PASSWORD) —
//      now provided for the SANDBOX account (2026-09-07) and stored in
//      .env.local (gitignored) — see TEST_SKUS below for the universal
//      sandbox SKUs that exercise every response scenario. Production
//      credentials are a separate, later step.
//   2. The SKU for each of our voucher brands (LOYALTY.VOUCHER_CATALOG in
//      lib/constants.js: "Amazon Pay", "Flipkart", ...) — confirmed via
//      the UAT test kit that IDs 324-338 (TEST_SKUS) are Qwikcilver's own
//      universal API-testing products, shared across every integrator to
//      exercise success/timeout/disabled/out-of-stock/etc. responses —
//      NOT real brand SKUs. BRAND_SKU_MAP starts empty until Qwikcilver's
//      program manager provisions real brands against this account and
//      the getCategories()/getProduct() helpers below (wired into
//      app/api/admin/qwikcilverdiag/route.js, same diagnostic-first
//      pattern as /api/admin/feeddiag) can browse the real catalog. Note
//      the vendor's own onboarding email: SKUs differ between sandbox and
//      production, so this has to be redone once production is live.
//
// Reference: https://developers.woohoo.in/docs/rest-api-v3-revamp/ and
// https://developers.woohoo.in/docs/get-started-title/oauth-2-0-protocol-recommended/

import { createHmac } from "node:crypto";
import { ProxyAgent } from "undici";

// --- Proxy plumbing ---------------------------------------------------
//
// IP allowlisting is CONFIRMED required, not just expected (2026-09-07):
// a direct call to sandbox.woohoo.in from an un-allowlisted IP gets a
// CloudFront-level 403 "Request blocked" before the app even sees it —
// this is enforced on the SANDBOX too, not just production, matching the
// UAT test kit's own warning ("non-whitelisted API requests will not be
// accepted"). Vercel serverless functions don't have a stable outbound IP
// by default, so calls are routed through QuotaGuard Static's
// load-balanced IP pair. Set QUOTAGUARDSTATIC_URL (from the QuotaGuard
// dashboard) as a Vercel env var and give their two static IPs to
// Qwikcilver to allowlist — this has to happen before ANY call works,
// sandbox included, not just before going live. Locally, with
// QUOTAGUARDSTATIC_URL unset, calls go out on whatever IP the machine
// making them has — get that IP allowlisted too if testing locally.
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

// TEMPORARY diagnostic (2026-09-08): proves or disproves whether the
// QuotaGuard proxy path itself is altering a POST body in transit,
// independent of anything Qwikcilver-specific — sends the exact same
// sorted/stringified body a real order would use to httpbin.org's public
// echo endpoint (through the same proxyFetch/dispatcher every real call
// uses) and reports whether what it echoes back is byte-identical to
// what was sent. Safe to remove once the real signature_invalid issue is
// resolved — httpbin.org is a well-known public testing service, nothing
// sensitive is exposed (the payload is the same non-secret billing info
// already visible via testOrder's debug echo).
export async function echoTest() {
  const sample = { billing: { firstname: "Amit", lastname: "Thakral", line1: "603 604 6th Floor" }, refno: `echo_${Date.now()}`, syncOnly: true };
  const bodyString = JSON.stringify(sortKeysDeep(sample));
  const resp = await proxyFetch("https://httpbin.org/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyString,
  });
  const data = await resp.json().catch(() => null);
  const echoedBody = data?.data; // httpbin returns the raw received body as `data.data`
  return {
    status: resp.status,
    sent: bodyString,
    echoedBack: echoedBody,
    identical: echoedBody === bodyString,
  };
}

// --- Our voucher_type -> Qwikcilver SKU ------------------------------
//
// See note 2 above. Confirmed via a real browse of this sandbox account's
// catalog (2026-09-08, category 219 "OnePlus Gift Card Store", the only
// category this account has): "Amazon Pay E-Gift Card" (SKU EGCGBAMZ001,
// ₹10-₹10,000 range) is the only LOYALTY.VOUCHER_CATALOG brand actually
// provisioned here — Flipkart/Myntra/Swiggy/MakeMyTrip/Yatra/Uber/
// BookMyShow are NOT in this sandbox's catalog at all and need
// Qwikcilver's program manager to provision them before they can be
// mapped. SANDBOX SKU ONLY — the vendor's own onboarding email states
// sandbox and production SKUs differ, so this needs re-verifying via
// /api/admin/qwikcilverdiag once production credentials exist.
const BRAND_SKU_MAP = {
  "Amazon Pay": "EGCGBAMZ001",
};

// Qwikcilver's own universal sandbox testing products (IDs 324-338,
// confirmed via the UAT test kit) — every sandbox account has these
// regardless of which real brands are provisioned, each one deterministically
// exercising one response scenario. Useful for exercising issueVoucher()'s
// error handling end-to-end before any real BRAND_SKU_MAP entry exists —
// e.g. `issueVoucher({ brand: "TEST_CNPIN", denomination: 100, redemptionId })`
// after temporarily pointing BRAND_SKU_MAP.TEST_CNPIN at TEST_SKUS.CNPIN.
export const TEST_SKUS = {
  CNPIN: "CNPIN",                     // success — returns a card number + PIN
  VOUCHER_CODE: "VOUCHERCODE",        // success — returns a single voucher code
  UBE_FLOW: "UBEFLOW",
  CLAIM_CODE: "CLAIMCODE",
  PROCESSING_STATUS: "PROCESSINGSTS", // simulates an async/processing order
  DISABLED: "DISABLEDSTS",            // simulates a disabled product
  CPG_INACTIVE: "CPGINACTIVE",
  PROGRAM_PARAMS_MISSING: "PROGPARAMSNA",
  OUT_OF_STOCK: "INVFAILURE",
  CARD_API_MISSING: "CARDAPINA",
  TIMEOUT_FAILURE: "APITESTTIMFAIL",
  TIMEOUT_SUCCESS: "testsuccess001",
};

// Explicit opt-in required for issueVoucher() (real member redemptions)
// to ever actually fire, on top of having credentials + a BRAND_SKU_MAP
// entry. Added 2026-09-08: BRAND_SKU_MAP going from empty to non-empty
// (once "Amazon Pay" was confirmed) would otherwise have silently made
// isConfigured() true and lit up the admin queue's "Auto-issue" button —
// while QWIKCILVER_CLIENT_ID/etc. still point at the SANDBOX, which hands
// back a fake, non-redeemable card. Flipping this requires a deliberate
// decision (set QWIKCILVER_LIVE=true in Vercel) at the same moment
// QWIKCILVER_* credentials are actually swapped to production — it can
// never happen as a side effect of testing. testOrder() (sandbox-only,
// TEST_SKUS only) is intentionally NOT gated by this.
function isLive() {
  return process.env.QWIKCILVER_LIVE === "true";
}

export function isConfigured() {
  return Boolean(
    isLive() &&
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

// Decodes (not verifies — no signature check needed, this is just for our
// own debug visibility) the JWT's payload to read `consumerId`. Added
// 2026-09-10 to settle a real open question: Qwikcilver's support team
// confirmed a working Order call using our exact Client Key in Postman,
// but the example body's billing details still say "Shreya" (their own
// internal test user) — decoding OUR OWN token's consumerId and comparing
// it against theirs is the only way to confirm the OAuth step is actually
// authenticating as our account, not something reused from a shared demo.
function decodeJwtConsumerId(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json).consumerId ?? null;
  } catch {
    return null;
  }
}

let cachedToken = null; // { token, expiresAt, consumerId }

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
  cachedToken = { token, expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000, consumerId: decodeJwtConsumerId(token) };
  return token;
}

// --- Request signing (OAuth2.0 Signature Generation Steps for Request) --
//
// A = method, C = encoded full URL (with sorted query params), D = "A&C",
// F = encoded JSON body with keys sorted recursively, G = "D&F".
// Signature = HMAC-SHA512(hex) of D (GET, no body) or G (POST with body),
// keyed on the client secret.
//
// Encoding is plain encodeURIComponent — NOT strict RFC3986 (which also
// escapes !'()*). The public docs describe RFC3986, but Qwikcilver's own
// Postman collection ships a signature-verification test script (it
// recomputes the signature client-side and compares it against the
// server's `signature` response header) that uses bare
// encodeURIComponent throughout — that's the authoritative reference,
// since it's checked against their real server on every sandbox call.
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

// Takes the already-sorted-and-stringified body (or undefined for a
// bodyless GET), NOT the raw object — the signature has to be computed
// over the EXACT bytes that get sent as the request body, byte for byte.
// (Real bug, found 2026-09-08: an earlier version signed a sorted
// version of the body but then sent the original unsorted one — passed
// every GET-only test, since GETs never exercise the body branch at all,
// then failed every POST with oauth_problem=signature_invalid the moment
// an Order call was actually tried. qcRequest below now derives
// bodyString once and uses that same string for both.)
function buildSignature({ method, url, bodyString, clientSecret }) {
  const A = method.toUpperCase();
  const C = encodeURIComponent(sortedUrlString(url));
  let base = `${A}&${C}`;
  if (bodyString !== undefined) {
    const F = encodeURIComponent(bodyString);
    base = `${base}&${F}`;
  }
  return createHmac("sha512", clientSecret).update(base).digest("hex");
}

// A signed, authenticated call to any QwikGiftAPI v3 endpoint. Returns the
// raw Response — callers decide how to interpret status/body, since the
// same helper backs both the issuance call and the read-only catalog
// helpers used by the admin diagnostic route.
//
// Retries exactly once on a 401 "token_rejected" response — the one case
// the UAT test kit explicitly documents as requiring re-auth (every other
// signed-request failure, e.g. signature_invalid, is a request-shape bug
// to fix, not something a retry helps with — retrying those would just
// mask the real error).
async function qcRequest(method, path, body, { _retried = false } = {}) {
  const apiBase = process.env.QWIKCILVER_API_BASE || "https://sandbox.woohoo.in/rest";
  const url = `${apiBase}${path}`;
  const token = await getBearerToken();
  const dateAtClient = new Date().toISOString();
  // Sorted+stringified ONCE — this exact string is what gets signed AND
  // what gets sent, so there is no possibility of the two diverging.
  const bodyString = body !== undefined && body !== null ? JSON.stringify(sortKeysDeep(body)) : undefined;
  const signature = buildSignature({ method, url, bodyString, clientSecret: process.env.QWIKCILVER_CLIENT_SECRET });
  const resp = await proxyFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      Authorization: `Bearer ${token}`,
      dateAtClient,
      signature,
    },
    body: bodyString,
  });
  // Attached for testOrder()'s debug echo only — a Response object is a
  // normal JS object, extra properties on it are otherwise inert.
  resp._qcDebug = { url, signature, bodyString, dateAtClient, consumerId: cachedToken?.consumerId ?? null };
  if (resp.status === 401 && !_retried) {
    const text = await resp.clone().text().catch(() => "");
    if (/token_rejected/i.test(text)) {
      cachedToken = null;
      return qcRequest(method, path, body, { _retried: true });
    }
  }
  return resp;
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
// telephone: a real, confirmed-working Order request Qwikcilver sent us
// (2026-09-09) uses "+919019078919" — the country code included, no
// spaces/dashes — not the bare 10-digit format used elsewhere in this
// codebase. Normalized here rather than changed at the source, since our
// own DB/UI convention for a 10-digit Indian mobile stays as-is.
function qcPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

function billingFromEnv() {
  return {
    firstname: process.env.QWIKCILVER_BILLING_NAME || "",
    lastname: process.env.QWIKCILVER_BILLING_LASTNAME || "",
    email: process.env.QWIKCILVER_BILLING_EMAIL || "",
    telephone: qcPhone(process.env.QWIKCILVER_BILLING_PHONE),
    line1: process.env.QWIKCILVER_BILLING_LINE1 || "",
    line2: process.env.QWIKCILVER_BILLING_LINE2 || "",
    city: process.env.QWIKCILVER_BILLING_CITY || "",
    region: process.env.QWIKCILVER_BILLING_REGION || "",
    country: process.env.QWIKCILVER_BILLING_COUNTRY || "IN",
    postcode: process.env.QWIKCILVER_BILLING_POSTCODE || "",
    company: process.env.QWIKCILVER_BILLING_COMPANY || "",
  };
}

// Read-only Order Status lookup (rest/v3/order/{refno}/status) — a
// follow-up call for the async path (order accepted with status 202:
// Processing). UPDATE 2026-09-11: this is NOT a rare edge case on this
// account — once `remarks`/`deliveryMode`/`syncOnly` were dropped to fix
// signature_invalid (see the top-of-file history), a real test order came
// back 202/PROCESSING and completed (status COMPLETE) shortly after. The
// order-status response itself carries no card/PIN — see
// getActivatedCards() below for that.
export async function getOrderStatus(refno) {
  const resp = await qcRequest("GET", `/v3/order/${encodeURIComponent(refno)}/status`);
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

// The Order Status response has no card/PIN fields at all — confirmed
// 2026-09-11 against a real COMPLETE order. Retrieving the actual card
// requires this separate call, keyed on `orderId` (the Order API's own
// response field, NOT our `refno`) — per the public docs:
// GET /v3/order/{orderId}/cards/?offset=&limit=
export async function getActivatedCards(orderId, { offset = 0, limit = 100 } = {}) {
  const resp = await qcRequest("GET", `/v3/order/${encodeURIComponent(orderId)}/cards/?offset=${offset}&limit=${limit}`);
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

// Places one order against a TEST_SKUS product instead of a real
// BRAND_SKU_MAP brand — same request-building/response-handling as
// issueVoucher below, so a working test order here is real end-to-end
// proof the OAuth flow, request signing, and Order API integration are
// all correct, before any real brand SKU exists. Wired into
// app/api/admin/qwikcilverdiag/route.js (POST). refno is prefixed
// "sllm_test_" (still under the 25-char cap) so it can never collide
// with a real redemption's "sllm_<redemptionId>" refno.
export async function testOrder(testSkuKey, denomination = 100) {
  const sku = TEST_SKUS[testSkuKey];
  if (!sku) return { ok: false, reason: `Unknown testSkuKey "${testSkuKey}" — must be one of: ${Object.keys(TEST_SKUS).join(", ")}` };

  const billing = billingFromEnv();
  if (!billing.firstname || !billing.email || !billing.telephone || !billing.line1 || !billing.city || !billing.region || !billing.postcode) {
    return { ok: false, reason: "Qwikcilver billing details incomplete — set QWIKCILVER_BILLING_* env vars (your own business contact info) before testing." };
  }

  const refno = `sllm_test_${Date.now()}`;
  // Diagnostic-only field, always included in this function's result
  // (never in issueVoucher's — this helper exists purely for eyeballing
  // exactly what's being signed/sent while chasing the
  // oauth_problem=signature_invalid failure on real POSTs). No secret is
  // ever part of this string — the client secret is only ever used as
  // the separate HMAC key, never mixed into the signed message itself.
  let debugBodyString;
  // Body matches, FIELD FOR FIELD, the raw cURL Qwikcilver's support team
  // sent back 2026-09-10 as a CONFIRMED WORKING Order call (200/201,
  // against our own Client Key per their statement) — no more, no less.
  // `remarks`, `deliveryMode`, and `syncOnly` were all previously included
  // here as plausible-sounding fields from the public docs/earlier
  // samples, but NONE of them appear in that real working request. Since
  // the signature covers the entire body, any field we send that isn't
  // in Qwikcilver's own schema is a real candidate for why every POST
  // failed signature_invalid while every field-free GET always worked —
  // if their server drops unrecognized fields before re-verifying the
  // signature, our extra fields alone would break the match. Removed
  // rather than left "just in case": matching their proven-working shape
  // exactly is worth more right now than any of those three fields'
  // speculative usefulness.
  const body = {
    billing,
    address: { ...billing, billToThis: true },
    payments: [{ code: "svc", amount: denomination }],
    refno,
    successUrl: "https://searchllm.shop/",
    failureUrl: "https://searchllm.shop/",
    // currency as a bare NUMBER (356), not a string — corrected 2026-09-09
    // against Qwikcilver's own real example, which contradicted the
    // string-typed "036" shown in an earlier (different) sample. giftMessage
    // is also from that same real example.
    products: [{ sku, price: denomination, qty: 1, currency: 356, giftMessage: "", theme: "" }],
  };
  debugBodyString = JSON.stringify(sortKeysDeep(body));

  let resp;
  try {
    // /v3/orders (plural) — confirmed 2026-09-08 against Qwikcilver's own
    // working Postman test on this account (202 Accepted, real orderId).
    // An earlier pass had "corrected" this to /v3/order (singular) based
    // on a different sample in the sandbox kit — that was wrong, and
    // explains the signature_invalid saga: hitting a route that doesn't
    // exist landed on generic auth middleware reporting a signature
    // error instead of a clean 404.
    resp = await qcRequest("POST", "/v3/orders", body);
  } catch (err) {
    return { ok: false, reason: `Qwikcilver request failed: ${String(err?.message || err)}`, debug: { bodyString: debugBodyString } };
  }
  const data = await resp.json().catch(() => null);
  return { ok: resp.status === 201, status: resp.status, refno, data, debug: { ...resp._qcDebug, bodyLength: debugBodyString.length } };
}

// The normalized contract the rest of the app depends on. Never throws —
// mirrors extractIntent()/generateClarifyingQuestions()'s "fail soft,
// caller falls back" pattern: the caller is the admin redemption queue,
// and manual code entry must keep working regardless of what this does.
//
// Returns { ok: true, voucherCode, raw } or { ok: false, reason }.
// `reason` is shown to the admin, never the shopper.
export async function issueVoucher({ brand, denomination, redemptionId }) {
  // Checked directly here too, not just via isConfigured() — this is the
  // one call with real consequences for an actual member redemption, so
  // it never trusts a single call site to have gated it correctly.
  if (!isLive()) {
    return { ok: false, reason: "Qwikcilver auto-issuance is not live (QWIKCILVER_LIVE is not \"true\") — credentials currently point at the sandbox, which returns fake, non-redeemable cards. Fulfil manually." };
  }
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
  // second voucher for the same redemption. Format per the UAT test kit:
  // "<Org shortcode>_<alphanumeric unique value>, not exceeding 25 chars"
  // — "sllm_" (5 chars) leaves ample room under that cap.
  const refno = `sllm_${redemptionId}`;

  // Only the fields Qwikcilver's own confirmed-working Order cURL shows
  // (2026-09-10) — see testOrder()'s matching comment for the full story:
  // `remarks`, `deliveryMode`, and `syncOnly` were removed here too, since
  // none of them appear in that real working request and the signature
  // covers the whole body.
  const body = {
    billing,
    address: { ...billing, billToThis: true },
    payments: [{ code: "svc", amount: denomination }],
    refno,
    successUrl: "https://searchllm.shop/",
    failureUrl: "https://searchllm.shop/",
    products: [{ sku, price: denomination, qty: 1, currency: 356, giftMessage: "", theme: "" }], // 356 = INR numeric currency code
  };

  let resp;
  try {
    // /v3/orders (plural) — see testOrder()'s matching comment for the
    // full story of how this got "corrected" to singular and back.
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
    // Async is the NORMAL path on this account (confirmed 2026-09-11,
    // once remarks/deliveryMode/syncOnly were dropped to fix
    // signature_invalid) — not the rare edge case the UAT kit implied for
    // qty:1. A real test order went PROCESSING -> COMPLETE within
    // seconds, so a short bounded poll here is worth it before falling
    // back to manual fulfilment. Budget kept small (route's maxDuration
    // is 30s total, and this call needs room for everything before it
    // too) — if it's still not done after this, it almost certainly will
    // be soon; the manual-fallback message still names the orderId so an
    // admin can resolve it via getOrderStatus/getActivatedCards without
    // re-placing the order.
    const orderId = data?.orderId;
    if (orderId) {
      const POLL_ATTEMPTS = 5;
      const POLL_DELAY_MS = 1500;
      for (let i = 0; i < POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
        let statusData;
        try {
          const statusResult = await getOrderStatus(refno);
          statusData = statusResult.data;
        } catch {
          continue; // a transient poll failure isn't fatal — just try again
        }
        if (statusData?.status !== "COMPLETE") continue;
        try {
          const cardsResult = await getActivatedCards(orderId);
          const card = cardsResult.data?.cards?.[0];
          if (card?.cardNumber) {
            const voucherCode = card.cardPin ? `${card.cardNumber} / PIN ${card.cardPin}` : card.cardNumber;
            return { ok: true, voucherCode, raw: cardsResult.data };
          }
        } catch (err) {
          return { ok: false, reason: `Order ${orderId} completed but fetching the card failed: ${String(err?.message || err)}. Fulfil manually via getActivatedCards("${orderId}").` };
        }
        break; // COMPLETE but no card in the response — fall through to manual
      }
    }
    return { ok: false, reason: `Qwikcilver accepted the order asynchronously (orderId ${orderId || "?"}, refno ${refno}) and it hadn't completed within the poll window. Check getOrderStatus("${refno}") shortly, then getActivatedCards("${orderId}") once COMPLETE, rather than retrying the order (refno is deterministic — a retry would hit the duplicate-order check below, not create a new one).` };
  }
  if (data?.code === 5313) {
    return { ok: false, reason: `An order for this redemption (refno ${refno}) may already exist at Qwikcilver — check the Order Details API before retrying, to avoid double-issuing.` };
  }
  return { ok: false, reason: `Qwikcilver order failed: ${data?.message || resp.statusText || resp.status} (code ${data?.code ?? "n/a"})` };
}
