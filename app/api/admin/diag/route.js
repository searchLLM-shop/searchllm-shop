// app/api/admin/diag/route.js
//
// Diagnostic endpoint — tests each part of the sync in isolation and
// returns readable results, so we can see exactly what works without
// digging through logs or fighting Vercel's generic "out of memory" label.
// Visit /api/admin/diag while signed in as admin.

import { auth, currentUser } from "@clerk/nextjs/server";
import { query, getExistingExternalIds, getFeedCursor } from "@/lib/db";

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
    const resp = await fetch(`https://productdata.awin.com/datafeed/list/apikey/${key}`);
    const text = await resp.text();
    const lines = text.split("\n");
    return {
      status: resp.status,
      bytes: text.length,
      lineCount: lines.length,
      header: lines[0]?.slice(0, 300),
      firstRow: lines[1]?.slice(0, 300),
    };
  });

  return Response.json({ mem: mem(), steps }, { status: 200 });
}
