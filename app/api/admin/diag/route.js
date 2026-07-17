// app/api/admin/diag/route.js
//
// Diagnostic endpoint — tests each part of the sync in isolation and
// returns readable results, so we can see exactly what works without
// digging through logs or fighting Vercel's generic "out of memory" label.
// Visit /api/admin/diag while signed in as admin.

import { auth, currentUser } from "@clerk/nextjs/server";
import { query, getExistingExternalIds, getFeedCursor } from "@/lib/db";
import { parseCsv } from "@/lib/feeds/awin";

export const maxDuration = 60;

async function isAdmin() {
  const user = await currentUser();
  if (!user) return false;
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(user.emailAddresses?.[0]?.emailAddress?.toLowerCase());
}

function mem() {
  try { return Math.round(process.memoryUsage().rss / 1048576) + "MB"; } catch { return "?"; }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const steps = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const result = await fn();
      steps.push({ name, ok: true, ms: Date.now() - t0, mem: mem(), result });
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t0, mem: mem(), error: String(err?.message || err) });
    }
  };

  // 1. Basic DB connectivity
  await step("db_connect", async () => {
    const { rows } = await query("SELECT 1 AS ok");
    return rows[0];
  });

  // 2. sync_state table exists / cursor readable
  await step("get_cursor", async () => {
    return { cursor: await getFeedCursor("awin_feed_cursor") };
  });

  // 3. existing IDs query
  await step("existing_ids", async () => {
    const ids = await getExistingExternalIds("Awin");
    return { count: ids.size };
  });

  // 4. Awin feed LIST download (no parse of products, just the list)
  await step("awin_list_fetch", async () => {
    const key = process.env.AWIN_DATAFEED_API_KEY;
    if (!key) return { skipped: "no AWIN_DATAFEED_API_KEY" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const resp = await fetch(`https://productdata.awin.com/datafeed/list/apikey/${key}`, { signal: ctrl.signal });
      const text = await resp.text();
      // Use the REAL quote-aware CSV parser — a naive split(",") breaks on
      // the commas inside quoted URL fields and misaligns every column.
      const rows = parseCsv(text);
      const header = rows[0].map((h) => h.trim());
      const statusIdx = header.findIndex((h) => h.toLowerCase().includes("membership"));
      const nameIdx = header.findIndex((h) => h.toLowerCase().includes("advertiser name"));
      const prodIdx = header.findIndex((h) => h.toLowerCase().includes("no of products"));
      const statusCounts = {};
      const joinedSamples = [];
      for (let i = 1; i < rows.length; i++) {
        const status = (rows[i][statusIdx] || "").trim();
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (status && status.toLowerCase() !== "not joined" && joinedSamples.length < 8) {
          joinedSamples.push({ name: rows[i][nameIdx], status, products: rows[i][prodIdx] });
        }
      }
      return {
        status: resp.status,
        feedRows: rows.length - 1,
        header,
        membershipStatusCounts: statusCounts,
        joinedFeedSamples: joinedSamples,
      };
    } finally {
      clearTimeout(timer);
    }
  });

  return Response.json({ mem: mem(), steps }, { status: 200 });
}
