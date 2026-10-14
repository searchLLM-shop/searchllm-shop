// app/invoice/[id]/page.jsx
//
// A printable receipt / GST tax invoice for one platform-fee payment.
// Owner-only: the document is looked up by (id, session user id), so one
// shopper can never open another's. "Print / Save as PDF" uses the
// browser's own print dialog — no PDF library, no stored files.

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getPaymentDocument } from "@/lib/db";
import { supplierConfig, formatInrPaise } from "@/lib/gst";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice — SearchLLM.shop", robots: { index: false, follow: false } };

const rowStyle = { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 };

export default async function InvoicePage({ params }) {
  const { id } = await params;
  const { userId } = await auth();
  const docId = Number.parseInt(id, 10);
  if (!userId || !Number.isInteger(docId)) notFound();

  const doc = await getPaymentDocument(userId, docId);
  if (!doc) notFound();

  const cfg = supplierConfig();
  const isInvoice = doc.docType === "tax_invoice";
  const paidOn = new Date(doc.paidAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

  return (
    <main style={{ maxWidth: 640, margin: "32px auto", padding: "0 20px", color: "#1a1a1a", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{isInvoice ? "Tax Invoice" : "Payment Receipt"}</div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{doc.docNumber}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{cfg.legalName}</div>
          {cfg.address && <div style={{ color: "#555", maxWidth: 260 }}>{cfg.address}</div>}
          {doc.supplierGstin && <div style={{ color: "#555" }}>GSTIN: {doc.supplierGstin}</div>}
        </div>
      </div>

      <div style={{ ...rowStyle, borderTop: "1px solid #ddd" }}><span>Date of payment</span><span>{paidOn}</span></div>
      <div style={rowStyle}><span>Payment reference</span><span>{doc.paymentId}</span></div>
      <div style={rowStyle}><span>Billed to</span><span>SearchLLM.shop member</span></div>
      {isInvoice && doc.placeOfSupply && <div style={rowStyle}><span>Place of supply (state code)</span><span>{doc.placeOfSupply}</span></div>}

      <div style={{ marginTop: 18, padding: "12px 0", borderTop: "1px solid #ddd", borderBottom: "1px solid #ddd" }}>
        <div style={{ ...rowStyle, fontWeight: 600 }}>
          <span>{doc.description}{isInvoice && doc.sac ? ` (SAC ${doc.sac})` : ""}</span>
          <span>{formatInrPaise(isInvoice ? doc.taxablePaise : doc.amountPaise)}</span>
        </div>
        {isInvoice && (
          <>
            {doc.cgstPaise > 0 && <div style={rowStyle}><span>CGST @ {Number(doc.gstRate) / 2}%</span><span>{formatInrPaise(doc.cgstPaise)}</span></div>}
            {doc.sgstPaise > 0 && <div style={rowStyle}><span>SGST @ {Number(doc.gstRate) / 2}%</span><span>{formatInrPaise(doc.sgstPaise)}</span></div>}
            {doc.igstPaise > 0 && <div style={rowStyle}><span>IGST @ {Number(doc.gstRate)}%</span><span>{formatInrPaise(doc.igstPaise)}</span></div>}
          </>
        )}
      </div>

      <div style={{ ...rowStyle, fontSize: 16, fontWeight: 700, paddingTop: 12 }}>
        <span>Total paid{isInvoice ? " (inclusive of GST)" : ""}</span>
        <span>{formatInrPaise(doc.amountPaise)}</span>
      </div>

      {!isInvoice && (
        <p style={{ fontSize: 12, color: "#666", marginTop: 20 }}>
          This is a receipt for the payment above. The amount paid is inclusive of any applicable taxes.
        </p>
      )}
      <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
        Computer-generated; no signature required. Questions: deploy@pibitsai.com
      </p>

      <PrintButton />
    </main>
  );
}
