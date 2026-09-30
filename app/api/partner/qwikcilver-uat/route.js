// app/api/partner/qwikcilver-uat/route.js
//
// Qwikcilver's UAT round-1 feedback asked us to "provide the test
// environment to perform testing from our end." Our diagnostic route
// (/api/admin/qwikcilverdiag) is gated on a Clerk admin session, and
// Qwikcilver has no account on this platform — so this is a second,
// parallel copy of that route's GET/POST behaviour, gated on a shared
// bearer token instead of Clerk, meant to be handed to Qwikcilver
// directly so they can trigger the same sandbox calls from their side.
//
// Auth: header `x-partner-token: <PARTNER_QWIKCILVER_TOKEN>` (env var,
// set in Vercel — see HANDOVER.md). No token configured -> 503, so this
// can never accidentally be open. Revoke access at any time by rotating
// or deleting that env var; nothing else depends on it.
//
// Everything this route can do is scoped to Qwikcilver's own TEST_SKUS
// sandbox products (or explicit SKUs Qwikcilver names in the request
// body themselves) via testOrder()/testOrderCustom() — it never touches
// a real brand SKU, a real customer order, or any of our own data. Logs
// every call (method, mode, caller IP) to the server console for an
// audit trail, since this is the one route on the whole site that a
// party outside the company can call directly.
//
// Same GET modes as /api/admin/qwikcilverdiag:
//   ?category=<id>              -> that category's subcategories
//   (no params)                  -> root category list
//   ?sku=<sku>                   -> product details
//   ?category=<id>&products=1   -> that category's products
//   ?orderStatus=<refno>         -> Order Status API — capped at 3 checks
//                                    per refno (2026-09-30, Qwikcilver's
//                                    own UAT feedback), enforced server-
//                                    side via partner_order_status_checks.
//   ?activatedCards=<orderId>    -> Activated Cards API
// Same POST bodies:
//   {testSku, denomination?}     -> testOrder()
//   {custom: {...}}              -> testOrderCustom() — see its doc
//                                    comment in lib/vouchers/qwikcilver.js

import { getCategories, listCategoryProducts, getProduct, testOrder, testOrderCustom, TEST_SKUS, getOrderStatus, getActivatedCards } from "@/lib/vouchers/qwikcilver";
import { checkAndRecordPartnerStatusCheck } from "@/lib/db";

export const maxDuration = 30;

function checkToken(req) {
  const configured = process.env.PARTNER_QWIKCILVER_TOKEN;
  if (!configured) return "Not configured";
  const given = req.headers.get("x-partner-token");
  if (given !== configured) return "Forbidden";
  return null;
}

function callerIp(req) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req) {
  const err = checkToken(req);
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 503 });

  const params = new URL(req.url).searchParams;
  const sku = params.get("sku");
  const category = params.get("category");
  const products = params.get("products");
  const orderStatus = params.get("orderStatus");
  const activatedCards = params.get("activatedCards");

  console.log(`[partner/qwikcilver-uat] GET from ${callerIp(req)} — ${req.url}`);

  try {
    if (orderStatus) {
      // Qwikcilver's own UAT feedback (2026-09-30): capped at 3 manual
      // checks per refno to avoid repeatedly hitting their server — see
      // schema.sql's partner_order_status_checks comment.
      const limitCheck = await checkAndRecordPartnerStatusCheck(orderStatus);
      if (!limitCheck.ok) {
        return Response.json(
          {
            error: `Order Status has already been checked ${limitCheck.checks - 1} times for this refno — capped at ${limitCheck.limit} to avoid repeated hits on your server. Place a new test order to check a fresh one.`,
            checksUsed: limitCheck.checks - 1,
            checksLimit: limitCheck.limit,
          },
          { status: 429 }
        );
      }
      const result = await getOrderStatus(orderStatus);
      return Response.json({ mode: "orderStatus", refno: orderStatus, checksUsed: limitCheck.checks, checksLimit: limitCheck.limit, ...result });
    }
    if (activatedCards) {
      const result = await getActivatedCards(activatedCards);
      return Response.json({ mode: "activatedCards", orderId: activatedCards, ...result });
    }
    if (sku) {
      const result = await getProduct(sku);
      return Response.json({ mode: "product", sku, ...result });
    }
    if (category && products) {
      const result = await listCategoryProducts(category);
      return Response.json({ mode: "categoryProducts", category, ...result });
    }
    const result = await getCategories(category || undefined);
    return Response.json({ mode: "categories", category: category || "(root)", testSkuKeys: Object.keys(TEST_SKUS), ...result });
  } catch (err2) {
    return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
  }
}

export async function POST(req) {
  const err = checkToken(req);
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 503 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  console.log(`[partner/qwikcilver-uat] POST from ${callerIp(req)} — ${JSON.stringify(body).slice(0, 500)}`);

  if (body.custom && typeof body.custom === "object") {
    try {
      const result = await testOrderCustom(body.custom);
      return Response.json(result);
    } catch (err2) {
      return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
    }
  }

  const testSku = String(body.testSku || "");
  if (!testSku) return Response.json({ error: `Pass {"testSku": "..."} — one of: ${Object.keys(TEST_SKUS).join(", ")}, or {"custom": {...}}` }, { status: 400 });

  try {
    const result = await testOrder(testSku, Number(body.denomination) || 100);
    return Response.json(result);
  } catch (err2) {
    return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
  }
}
