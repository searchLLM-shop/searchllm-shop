// app/api/admin/qwikcilverdiag/route.js
//
// Same idea as /api/admin/feeddiag: reads the LIVE Qwikcilver account
// (categories, or a specific product's SKU details) instead of guessing
// at what's in it. This is how lib/vouchers/qwikcilver.js's BRAND_SKU_MAP
// should actually get filled in — browse categories here, find the SKU
// for each of LOYALTY.VOUCHER_CATALOG's brands, then hardcode the mapping.
//
// GET  ?category=<id>   -> that category's subcategories/products
// GET  (no params)       -> root category list
// GET  ?sku=<sku>        -> full product details (denominations, price type)
// GET  ?orderStatus=<refno> -> Order Status API for a refno testOrder()
//   returned as 202/PROCESSING (added 2026-09-11 once signature_invalid
//   was finally resolved and a real order started coming back async).
// GET  ?activatedCards=<orderId> -> the actual card number/PIN for a
//   COMPLETE order — keyed on `orderId` (the Order API's own response
//   field), NOT `refno`. Order Status alone carries no card details.
// POST {testSku, denomination?} -> places one real order against a
//   Qwikcilver TEST_SKUS product (not a real brand) — end-to-end proof
//   the OAuth flow, request signing, and Order API are wired correctly,
//   without needing a real BRAND_SKU_MAP entry yet. See testOrder() in
//   lib/vouchers/qwikcilver.js for the full list of testSku keys.
// POST {custom: {...}} -> places one order with any combination of
//   qty/paymentCode/refno/telephone/products/corruptToken/corruptSignature
//   overrides (added 2026-09-14 for the UAT test-case sheet's failure
//   scenarios). See testOrderCustom()'s doc comment in
//   lib/vouchers/qwikcilver.js for every option.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { getCategories, listCategoryProducts, getProduct, testOrder, testOrderCustom, TEST_SKUS, echoTest, getOrderStatus, getActivatedCards } from "@/lib/vouchers/qwikcilver";

export const maxDuration = 30;

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return "Not signed in";
  const user = await currentUser();
  if (!isAdminUser(user)) return "Forbidden";
  return null;
}

export async function GET(req) {
  const err = await requireAdmin();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });

  const params = new URL(req.url).searchParams;
  const sku = params.get("sku");
  const category = params.get("category");
  const products = params.get("products");

  try {
    // TEMPORARY: proves/disproves whether the QuotaGuard proxy path
    // itself alters a POST body in transit — see echoTest() in
    // lib/vouchers/qwikcilver.js. Remove once signature_invalid is
    // resolved.
    if (params.get("echoTest")) {
      const result = await echoTest();
      return Response.json(result);
    }
    const orderStatus = params.get("orderStatus");
    if (orderStatus) {
      const result = await getOrderStatus(orderStatus);
      return Response.json({ mode: "orderStatus", refno: orderStatus, ...result });
    }
    const activatedCards = params.get("activatedCards");
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
  const err = await requireAdmin();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  // {custom: {...}} -> testOrderCustom(), for the UAT failure-scenario
  // rows (#6, #12, #14, #16-20, #27) that plain testOrder() can't reach
  // (fixed qty/payment-method/single-SKU shape). See testOrderCustom()'s
  // own doc comment in lib/vouchers/qwikcilver.js for every option.
  if (body.custom && typeof body.custom === "object") {
    try {
      const result = await testOrderCustom(body.custom);
      return Response.json(result);
    } catch (err2) {
      return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
    }
  }

  const testSku = String(body.testSku || "");
  if (!testSku) return Response.json({ error: `Pass {"testSku": "..."} — one of: ${Object.keys(TEST_SKUS).join(", ")}, or {"custom": {...}} — see testOrderCustom() in lib/vouchers/qwikcilver.js` }, { status: 400 });

  try {
    const result = await testOrder(testSku, Number(body.denomination) || 100);
    return Response.json(result);
  } catch (err2) {
    return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
  }
}
