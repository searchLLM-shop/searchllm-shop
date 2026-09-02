// app/api/admin/feeddiag/route.js
//
// Reads the LIVE product feed and reports exactly what it contains — actual
// column names, a sample row, and what the parser makes of it.
//
// Every fix so far has been based on sample files sent by email, and the live
// feed has differed from them each time. This looks at the real thing instead
// of inferring from a copy.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { parseCsv } from "@/lib/feeds/awin";
import { parseProductRow } from "@/lib/feeds/vcommissionProducts";

export const maxDuration = 60;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const urls = (process.env.VCOMMISSION_PRODUCT_FEED_URLS || "")
    .split(",").map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return Response.json({ error: "VCOMMISSION_PRODUCT_FEED_URLS not set" });

  const which = Number(new URL(req.url).searchParams.get("feed")) || 0;
  const feedUrl = urls[which % urls.length];
  const out = { feedUrl: feedUrl.split("/").pop(), feedIndex: which % urls.length, totalFeeds: urls.length };

  try {
    // --- header ---
    const headResp = await fetch(feedUrl, { headers: { Range: "bytes=0-16383" } });
    out.headerStatus = headResp.status;
    out.contentRange = headResp.headers.get("content-range");
    out.contentType = headResp.headers.get("content-type");
    const raw = await headResp.text();
    out.bytesReceived = raw.length;

    const lines = raw.split("\n");
    out.headerLineLength = lines[0]?.length || 0;
    const headerRow = parseCsv(lines[0] || "")[0] || [];
    // THE key output — the real column names, in order.
    out.columns = headerRow.map((h) => h.trim());
    out.columnCount = out.columns.length;

    // --- first data row, exactly as parsed ---
    const afterHeader = raw.slice((lines[0]?.length || 0) + 1);
    const dataRows = parseCsv(afterHeader);
    out.sampleRowFieldCount = dataRows[0]?.length || 0;

    if (dataRows[0]) {
      const obj = {};
      out.columns.forEach((c, i) => { obj[c] = dataRows[0][i] ?? ""; });
      // Truncate values — this is about shape, not content.
      out.sampleRow = Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, String(v).slice(0, 70)])
      );
      const parsed = parseProductRow(obj);
      out.parsedOk = Boolean(parsed);
      out.parseResult = parsed
        ? { externalId: parsed.externalId, product: parsed.product.slice(0, 50), price: parsed.price, hasLink: Boolean(parsed.networkLink) }
        : {
            reason: "parseProductRow returned null",
            product_id: obj.product_id ? "present" : "MISSING",
            name: obj.name ? "present" : "MISSING",
            tracking_url: obj.tracking_url ? "present" : "MISSING",
            availability: obj.availability || "(empty)",
          };
    }
  } catch (err) {
    out.error = String(err?.message || err);
  }

  return Response.json(out);
}
