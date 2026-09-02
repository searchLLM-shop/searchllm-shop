// app/api/admin/reports/export/route.js
//
// Downloads the full reports dataset as a multi-sheet .xlsx workbook —
// the same numbers the panel shows, in a form that can be filed, shared
// with an investor, or pivoted in Excel. Admin-gated like every report.
//
// Data only, no formulas: every cell is a value computed by the same SQL
// the panel uses, so the file needs no recalculation and opens identically
// everywhere. Commission columns stay per-network-per-currency for the same
// reason they do in the panel: INR and EUR must never be summed together.

import { auth, currentUser } from "@clerk/nextjs/server";
import * as XLSX from "xlsx";
import { getReportSummary } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdmin";

export const maxDuration = 60;

const num = (v) => (v === null || v === undefined ? null : Number(v));

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const days = Math.min(Number(params.get("days")) || 30, 90);
  const range = params.get("from") && params.get("to")
    ? { from: params.get("from"), to: params.get("to") }
    : null;

  let r;
  try {
    r = await getReportSummary(days, range);
  } catch (err) {
    console.error("Export failed:", err);
    return Response.json({ error: "Could not build export", detail: String(err?.message || err) }, { status: 500 });
  }

  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => {
    // Excel rejects sheet names over 31 chars or containing []:*?/\
    const safe = String(name).replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "no data yet" }]), safe);
  };

  const t = r.totals || {};
  const a = r.activity || {};
  const rev = r.revenue || {};
  const rt = rev.totals || {};

  addSheet("Overview", [
    { metric: "Report window", value: r.range ? `${r.range.from} to ${r.range.to}` : `last ${days} days` },
    { metric: "Generated (UTC)", value: new Date().toISOString() },
    { metric: "Total visitors (all time)", value: num(t.total_visitors) },
    { metric: "Registered users", value: num(t.registered_users) },
    { metric: "Total searches (all time)", value: num(t.total_searches) },
    { metric: "Affiliate clicks (all time)", value: num(t.total_clicks) },
    { metric: "Searches with no match", value: num(t.no_match_searches) },
    { metric: "Daily-limit hits", value: num(t.limit_hits) },
    { metric: "Active today (DAU)", value: num(a.dau) },
    { metric: "Active this week (WAU)", value: num(a.wau) },
    { metric: "Active this month (MAU)", value: num(a.mau) },
    { metric: `Outbound tracked clicks (${days}d)`, value: num(rt.out_clicks) },
    { metric: `Conversions matched (${days}d)`, value: num(rt.conversions) },
    { metric: `Conversions pending (${days}d)`, value: num(rt.pending) },
    { metric: `Conversions approved (${days}d)`, value: num(rt.approved) },
    { metric: `Conversions declined (${days}d)`, value: num(rt.declined) },
  ]);

  addSheet("Revenue by network", (rev.byNetwork || []).map((x) => ({
    network: x.network,
    currency: x.currency,
    out_clicks: num(x.out_clicks),
    conversions: num(x.conversions),
    order_value: num(x.order_value),
    commission_pending: num(x.commission_pending),
    commission_approved: num(x.commission_approved),
    commission_declined: num(x.commission_declined),
  })));

  addSheet("Revenue daily", (rev.daily || []).map((d) => ({
    day: String(d.day).slice(0, 10),
    out_clicks: num(d.out_clicks),
    conversions: num(d.conversions),
    commission: num(d.commission),
  })));

  addSheet("Daily activity", (r.daily || []).map((d) => ({
    day: String(d.day).slice(0, 10),
    searches: num(d.searches),
    visitors: num(d.visitors),
    active_users: num(d.active_users),
    affiliate_clicks: num(d.clicks),
  })));

  addSheet("Top products", (r.topProducts || []).map((p) => ({
    product: p.product, brand: p.brand, network: p.network, price: p.price, clicks: num(p.clicks),
  })));

  addSheet("Clicks by network", (r.byNetwork || []).map((x) => ({
    network: x.network, clicks: num(x.clicks),
  })));

  addSheet("Traffic sources", (r.sources || []).map((s) => ({
    source: s.source, medium: s.medium, campaign: s.campaign,
    visitors: num(s.visitors), visits: num(s.visits),
  })));

  addSheet("Campaigns", (r.campaigns || []).map((c) => ({
    source: c.source, campaign: c.campaign,
    visitors: num(c.visitors), searches: num(c.searches), affiliate_clicks: num(c.affiliate_clicks),
  })));

  addSheet("Inventory", (r.inventory || []).map((x) => ({
    network: x.network, status: x.status, listings: num(x.listings),
  })));

  addSheet("Inventory by country", (r.inventoryByCountry || []).map((c) => ({
    country: c.country, total: num(c.total), approved: num(c.approved), pending: num(c.pending),
  })));

  addSheet("Inventory by category", (r.inventoryByCategory || []).map((c) => ({
    category: c.category, total: num(c.total), approved: num(c.approved), pending: num(c.pending),
  })));

  addSheet("Rewards issuance", (r.rewards?.issuance || []).map((x) => ({
    source: x.source, status: x.status, entries: num(x.entries), points: num(x.points),
  })));

  addSheet("Rewards redemptions", (r.rewards?.byVoucher || []).map((v) => ({
    voucher: v.voucher_type, status: v.status, count: num(v.redemptions), value_inr: num(v.points_value),
  })));

  addSheet("Clicks by day", (r.clicksReport?.byDay || []).map((c) => ({
    day: c.day, sponsored_clicks: num(c.sponsored_clicks), alternative_clicks: num(c.alternative_clicks),
  })));

  addSheet("Alternative demand", (r.clicksReport?.altDemand || []).map((c) => ({
    brand: c.brand, product: c.product, clicks: num(c.clicks), first_seen: c.first_seen, last_seen: c.last_seen,
  })));

  addSheet("App installs summary", [{
    unique_visitors: num(r.pwa?.visitors),
    installs: num(r.pwa?.installs),
    installs_per_100_visitors: r.pwa?.installRate ?? "",
    app_users: num(r.pwa?.appUsers),
    app_users_per_100_visitors: r.pwa?.appUserRate ?? "",
    app_sessions: num(r.pwa?.appSessions),
    prompts_dismissed: num(r.pwa?.dismissed),
  }]);

  addSheet("App installs by day", (r.pwa?.daily || []).map((d) => ({
    day: d.day, installs: num(d.installs), app_users: num(d.app_users),
  })));

  addSheet("Queries by day", (r.clicksReport?.queriesByDay || []).map((q) => ({
    day: q.day, query: q.query_text, matched_inventory: q.matched ? "yes" : "no",
  })));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const rangeLabel = r.range ? `${r.range.from}_to_${r.range.to}` : `${days}d`;
  const filename = `searchllm-report-${rangeLabel}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
