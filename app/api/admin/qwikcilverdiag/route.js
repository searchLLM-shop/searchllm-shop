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
// POST {testSku, denomination?} -> places one real order against a
//   Qwikcilver TEST_SKUS product (not a real brand) — end-to-end proof
//   the OAuth flow, request signing, and Order API are wired correctly,
//   without needing a real BRAND_SKU_MAP entry yet. See testOrder() in
//   lib/vouchers/qwikcilver.js for the full list of testSku keys.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { getCategories, listCategoryProducts, getProduct, testOrder, TEST_SKUS } from "@/lib/vouchers/qwikcilver";

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

  const testSku = String(body.testSku || "");
  if (!testSku) return Response.json({ error: `Pass {"testSku": "..."} — one of: ${Object.keys(TEST_SKUS).join(", ")}` }, { status: 400 });

  try {
    const result = await testOrder(testSku, Number(body.denomination) || 100);
    return Response.json(result);
  } catch (err2) {
    return Response.json({ error: String(err2?.message || err2) }, { status: 500 });
  }
}
