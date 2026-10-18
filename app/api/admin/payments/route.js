// app/api/admin/payments/route.js
//
// Admin view of every platform-fee receipt / tax invoice, so payments can be
// checked against Razorpay's own records.
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD            -> our documents + totals
//   GET ...&reconcile=1                           -> also compares with
//                                                    Razorpay's captured payments
//   GET ...&format=csv                            -> the same rows as a CSV
//
// Admin only. Payers are shown by mobile number (decrypted), as in the other
// admin reports.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { listAllPaymentDocuments, getDecryptedPhonesForUsers } from "@/lib/db";
import { fetchRazorpayPayments, reconcile } from "@/lib/razorpayRecon";

export const maxDuration = 60;

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const ymd = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rupees = (paise) => (paise == null ? "" : (Number(paise) / 100).toFixed(2));

export async function GET(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdminUser(await currentUser())) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const now = new Date();
  const to = validYmd(params.get("to")) ? params.get("to") : ymd(now);
  const from = validYmd(params.get("from")) ? params.get("from") : ymd(new Date(now.getTime() - 30 * 86400000));

  try {
    const documents = await listAllPaymentDocuments({ from, to });
    const phones = await getDecryptedPhonesForUsers(documents.map((d) => d.userId));
    const rows = documents.map((d) => ({ ...d, phone: phones.get(d.userId) || null }));

    if (params.get("format") === "csv") {
      const header = ["document_number", "type", "payment_id", "paid_at_ist", "amount_inr", "taxable_inr", "cgst_inr", "sgst_inr", "igst_inr", "gst_rate", "mobile", "user_id", "description"];
      const lines = [header.join(",")].concat(
        rows.map((r) =>
          [
            r.docNumber, r.docType, r.paymentId,
            new Date(new Date(r.paidAt).getTime() + IST_OFFSET_MS).toISOString().replace("T", " ").slice(0, 19),
            rupees(r.amountPaise), rupees(r.taxablePaise), rupees(r.cgstPaise), rupees(r.sgstPaise), rupees(r.igstPaise),
            r.gstRate, r.phone, r.userId, r.description,
          ].map(csvCell).join(",")
        )
      );
      return new Response(lines.join("\n") + "\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="platform-fee-payments-${from}-to-${to}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const sum = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    const totals = {
      count: rows.length,
      amountPaise: sum("amountPaise"),
      taxablePaise: sum("taxablePaise"),
      cgstPaise: sum("cgstPaise"),
      sgstPaise: sum("sgstPaise"),
      igstPaise: sum("igstPaise"),
    };

    let reconciliation = null;
    let reconcileError = null;
    if (params.get("reconcile") === "1") {
      try {
        // IST day boundaries as unix seconds.
        const fromUnix = Math.floor((Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS) / 1000);
        const toUnix = Math.floor((Date.parse(`${to}T00:00:00Z`) - IST_OFFSET_MS) / 1000) + 86400 - 1;
        const rzp = await fetchRazorpayPayments({ fromUnix, toUnix });
        const result = reconcile(rows, rzp);
        reconciliation = result;
      } catch (err) {
        reconcileError = String(err?.message || err);
      }
    }

    return Response.json({ range: { from, to }, totals, documents: rows, reconciliation, reconcileError });
  } catch (err) {
    console.error("Admin payments failed:", err);
    return Response.json({ error: "Could not load payments", detail: String(err?.message || err) }, { status: 500 });
  }
}
