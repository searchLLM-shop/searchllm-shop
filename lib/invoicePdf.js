// lib/invoicePdf.js
//
// A one-page receipt / GST tax invoice as a real PDF, with no dependency.
// The document is a handful of text lines, so a hand-written PDF (standard
// Helvetica fonts, no embedding) is smaller and safer than a PDF library:
// nothing to install, nothing to keep patched, deterministic output.
//
// Standard PDF fonts cannot show the rupee sign, so amounts are written
// "Rs. 399.00" here (the on-screen invoice page uses the ₹ symbol). Any other
// non-Latin-1 character is replaced rather than corrupting the file.

const PAGE_W = 595; // A4 in points
const PAGE_H = 842;

function sanitize(s) {
  return String(s ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function esc(s) {
  return sanitize(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(paise) {
  return `Rs. ${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrap(text, max) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// doc: a row from getPaymentDocument(); cfg: supplierConfig().
export function buildInvoicePdf(doc, cfg) {
  const isInvoice = doc.docType === "tax_invoice";
  const ops = [];
  let y = PAGE_H - 60;
  const text = (x, size, bold, str) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(str)}) Tj ET`);
  const rule = () => ops.push(`0.6 w 50 ${y} m ${PAGE_W - 50} ${y} l S`);
  const row = (label, value, { bold = false, size = 11 } = {}) => {
    text(50, size, bold, label);
    text(380, size, bold, value);
    y -= size + 7;
  };

  // Header
  text(50, 20, true, isInvoice ? "TAX INVOICE" : "PAYMENT RECEIPT");
  y -= 22;
  text(50, 11, false, doc.docNumber);
  y -= 26;

  // Supplier
  text(50, 12, true, cfg.legalName);
  y -= 16;
  for (const line of wrap(cfg.address || "", 70)) {
    text(50, 10, false, line);
    y -= 13;
  }
  if (doc.supplierGstin) {
    text(50, 10, false, `GSTIN: ${doc.supplierGstin}`);
    y -= 13;
  }
  y -= 10;
  rule();
  y -= 20;

  // Details
  const paidOn = new Date(doc.paidAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
  row("Date of payment", paidOn);
  row("Payment reference", doc.paymentId);
  row("Billed to", "SearchLLM.shop member");
  if (isInvoice && doc.placeOfSupply) row("Place of supply (state code)", doc.placeOfSupply);
  y -= 6;
  rule();
  y -= 20;

  // Line item + tax breakup
  const desc = `${doc.description}${isInvoice && doc.sac ? ` (SAC ${doc.sac})` : ""}`;
  const descLines = wrap(desc, 52);
  descLines.forEach((line, i) => {
    text(50, 11, true, line);
    if (i === 0) text(380, 11, true, money(isInvoice ? doc.taxablePaise : doc.amountPaise));
    y -= 16;
  });
  if (isInvoice) {
    const half = Number(doc.gstRate) / 2;
    if (doc.cgstPaise > 0) row(`CGST @ ${half}%`, money(doc.cgstPaise));
    if (doc.sgstPaise > 0) row(`SGST @ ${half}%`, money(doc.sgstPaise));
    if (doc.igstPaise > 0) row(`IGST @ ${Number(doc.gstRate)}%`, money(doc.igstPaise));
  }
  y -= 4;
  rule();
  y -= 20;
  row(isInvoice ? "Total paid (inclusive of GST)" : "Total paid", money(doc.amountPaise), { bold: true, size: 13 });

  y -= 18;
  if (!isInvoice) {
    for (const line of wrap("This is a receipt for the payment above. The amount paid is inclusive of any applicable taxes.", 90)) {
      text(50, 9, false, line);
      y -= 12;
    }
  }
  text(50, 9, false, "Computer-generated; no signature required. Questions: deploy@pibitsai.com");

  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
