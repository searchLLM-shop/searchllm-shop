// app/api/admin/performance/route.js
//
// Product performance: which products get clicked and which actually sell,
// across all networks — built from the /out/ click log and the conversion
// poll. This is the ground truth the queries tab can only hint at.

import { auth, currentUser } from "@clerk/nextjs/server";
import { getProductPerformance, getPerformanceByCategory } from "@/lib/db";
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
  const days = Math.min(Number(url.searchParams.get("days")) || 30, 90);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  try {
    const [{ items, total }, byCategory] = await Promise.all([
      getProductPerformance(days, page, PAGE_SIZE),
      getPerformanceByCategory(days),
    ]);
    return Response.json({ items, total, page, pageSize: PAGE_SIZE, byCategory });
  } catch (err) {
    console.error("Performance failed:", err);
    return Response.json({ error: "Could not load performance", detail: String(err?.message || err) }, { status: 500 });
  }
}
