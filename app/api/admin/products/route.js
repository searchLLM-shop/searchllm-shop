// app/api/admin/products/route.js
//
// The admin product browser. Without a network param it returns the network
// list with inventory counts (the clickable pills); with one it returns that
// network's APPROVED products, paginated — approved because that is the set
// that can actually be shown to a shopper, which is what the browser is for.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getInventoryByNetwork, getApprovedListingsByNetwork, getCategoriesForNetwork } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

export const maxDuration = 30;
const PAGE_SIZE = 50;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const network = url.searchParams.get("network");
  const category = url.searchParams.get("category") || null;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  try {
    if (!network) {
      const networks = await getInventoryByNetwork();
      return Response.json({ networks });
    }
    const [{ items, total }, categories] = await Promise.all([
      getApprovedListingsByNetwork(network, page, PAGE_SIZE, category),
      getCategoriesForNetwork(network),
    ]);
    return Response.json({ items, total, page, pageSize: PAGE_SIZE, categories });
  } catch (err) {
    console.error("Product browser failed:", err);
    return Response.json({ error: "Could not load products", detail: String(err?.message || err) }, { status: 500 });
  }
}
