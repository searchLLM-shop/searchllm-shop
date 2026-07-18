// app/api/brands/route.js
//
// Handles brand listing submissions. Every submission lands as 'pending' —
// nothing here can write directly to 'approved'. That gate only exists in
// /api/admin/listings, which itself is gated by an admin-email check.

import { insertListing } from "@/lib/db";

const VALID_NETWORKS = ["Awin", "Impact", "vCommission"];
const VALID_CATEGORIES = ["outdoor", "electronics", "beauty", "home", "fashion", "health", "shopping", "services", "other"];

export async function POST(req) {
  try {
    const body = await req.json();
    const { brand, product, price, category, keywords, network, networkLink, pitch } = body;

    if (!brand || !product || !networkLink) {
      return Response.json(
        { error: "Brand name, product name, and tracking link are required" },
        { status: 400 }
      );
    }
    if (!VALID_NETWORKS.includes(network)) {
      return Response.json({ error: "Invalid network" }, { status: 400 });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return Response.json({ error: "Invalid category" }, { status: 400 });
    }

    const keywordArray = Array.isArray(keywords)
      ? keywords
      : String(keywords || "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);

    const id = await insertListing({
      brand: String(brand).slice(0, 200),
      product: String(product).slice(0, 200),
      price: price ? String(price).slice(0, 50) : null,
      category: category || "other",
      keywords: keywordArray.slice(0, 20),
      network,
      networkLink: String(networkLink).slice(0, 1000),
      pitch: pitch ? String(pitch).slice(0, 500) : null,
    });

    return Response.json({ id, status: "pending" }, { status: 201 });
  } catch (err) {
    console.error("Brand submission error:", err);
    return Response.json({ error: "Unable to submit listing" }, { status: 500 });
  }
}
