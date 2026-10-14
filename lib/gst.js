// lib/gst.js
//
// GST arithmetic and document numbering for platform-fee invoices/receipts.
//
// Everything here is PURE and configured from the environment, because the
// legal position (is piBits GST-registered, which SAC applies, what rate)
// is the company's and its CA's to set — not something code should assume:
//
//   GST_GSTIN              supplier GSTIN. UNSET => no tax is shown and the
//                          document is a plain payment receipt, never a tax
//                          invoice (issuing a GST invoice without
//                          registration is not allowed).
//   GST_RATE               percent, default 18
//   GST_SAC                service accounting code, default 9983
//   GST_SUPPLIER_STATE     two-digit GST state code of the supplier,
//                          default 09 (Uttar Pradesh — Noida)
//   INVOICE_LEGAL_NAME     default "piBits AI Solutions Pvt Ltd"
//   INVOICE_ADDRESS        registered office / invoicing address
//
// The amount the shopper pays (LOYALTY.PLATFORM_FEE_INR) is GST-INCLUSIVE —
// the pricing page has always said "prices shown include applicable tax" —
// so the invoice DECOMPOSES what was paid; it never adds anything on top.

export function supplierConfig() {
  const gstin = (process.env.GST_GSTIN || "").trim().toUpperCase();
  const rate = Number(process.env.GST_RATE || 18);
  return {
    gstin: gstin || null,
    registered: Boolean(gstin),
    rate: Number.isFinite(rate) && rate >= 0 ? rate : 18,
    sac: (process.env.GST_SAC || "9983").trim(),
    stateCode: (process.env.GST_SUPPLIER_STATE || "09").trim(),
    legalName: (process.env.INVOICE_LEGAL_NAME || "piBits AI Solutions Pvt Ltd").trim(),
    address: (process.env.INVOICE_ADDRESS || "").trim() || null,
  };
}

// Splits a GST-inclusive total (in paise) into taxable value + tax. Tax is
// the remainder after rounding the taxable value, so the parts always sum
// back to exactly what was paid. Intra-state: CGST and SGST, half each
// (any odd paisa goes to SGST).
export function splitInclusive(totalPaise, ratePct) {
  const total = Math.round(Number(totalPaise));
  if (!Number.isFinite(total) || total <= 0) throw new Error("invalid amount");
  const taxable = Math.round(total / (1 + ratePct / 100));
  const tax = total - taxable;
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  return { totalPaise: total, taxablePaise: taxable, taxPaise: tax, cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

// Indian financial year (April–March) of an instant, in IST.
// Returns { label: "2026-27", short: "26-27" }.
export function financialYear(date = new Date()) {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? y : y - 1; // month index 3 = April
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  const startYY = String(startYear % 100).padStart(2, "0");
  return { label: `${startYear}-${endYY}`, short: `${startYY}-${endYY}` };
}

// GST rule: invoice numbers are consecutive per financial year, unique, at
// most 16 characters of letters/digits/"-"/"/". "SLM/26-27/000001" is
// exactly 16.
export function documentNumber(docType, fyShort, seq) {
  const prefix = docType === "tax_invoice" ? "SLM" : "RCP";
  return `${prefix}/${fyShort}/${String(seq).padStart(6, "0")}`;
}

export function formatInrPaise(paise) {
  return `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
