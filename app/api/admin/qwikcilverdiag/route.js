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

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { getCategories, listCategoryProducts, getProduct } from "@/lib/vouchers/qwikcilver";

export const maxDuration = 30;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
    return Response.json({ mode: "categories", category: category || "(root)", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
