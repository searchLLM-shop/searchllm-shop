// app/api/admin/redemptions/export/route.js
//
// A complete, downloadable redemption history — every row, not just the
// 100 most recent (see getRedemptionQueue vs getAllRedemptions in
// lib/db.js), optionally bounded to a date range. Deliberately its own
// endpoint rather than another sheet on the general business-metrics
// export (/api/admin/reports/export): this file carries decrypted RBI KYC
// PII on every row, and a PII export should be a distinct, deliberate
// action, not a sheet that comes along for the ride whenever someone grabs
// the general report. Once downloaded this is a plaintext file on the
// admin's machine — handle and store it accordingly.

import { auth, currentUser } from "@clerk/nextjs/server";
import * as XLSX from "xlsx";
import { getAllRedemptions } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdmin";

export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = await currentUser();
  if (!isAdminUser(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : null;
  const to = toParam && DATE_RE.test(toParam) ? toParam : null;

  let rows;
  try {
    rows = await getAllRedemptions({ from, to });
  } catch (err) {
    console.error("Redemption export failed:", err);
    return Response.json({ error: "Could not build export", detail: String(err?.message || err) }, { status: 500 });
  }

  const sheetRows = rows.length
    ? rows.map((r) => ({
        id: r.id,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : "",
        status: r.status,
        points: Number(r.points),
        voucher_type: r.voucher_type,
        voucher_code: r.voucher_code || "",
        fulfilled_at: r.fulfilled_at ? new Date(r.fulfilled_at).toISOString() : "",
        first_name: r.kyc_first_name || "",
        last_name: r.kyc_last_name || "",
        mobile: r.kyc_mobile || "",
        email: r.kyc_email || "",
        address: r.kyc_address || "",
        kyc_confirmed_at: r.kyc_confirmed_at ? new Date(r.kyc_confirmed_at).toISOString() : "",
        user_id: r.user_id,
      }))
    : [{ note: "No redemptions in this range" }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), "Redemptions");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const rangeLabel = from && to ? `${from}_to_${to}` : from ? `from_${from}` : to ? `through_${to}` : "all";
  const filename = `searchllm-redemptions-${rangeLabel}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
