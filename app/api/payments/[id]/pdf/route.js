// app/api/payments/[id]/pdf/route.js
//
// Download one receipt / tax invoice as a PDF. Owner-only: looked up by
// (document id, session user id), so another member's id returns 404.

import { auth } from "@clerk/nextjs/server";
import { getPaymentDocument } from "@/lib/db";
import { supplierConfig } from "@/lib/gst";
import { buildInvoicePdf } from "@/lib/invoicePdf";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const { id } = await params;
  const { userId } = await auth();
  const docId = Number.parseInt(id, 10);
  if (!userId || !Number.isInteger(docId)) return new Response("Not found", { status: 404 });

  const doc = await getPaymentDocument(userId, docId);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = buildInvoicePdf(doc, supplierConfig());
  // Document numbers contain "/", which isn't valid in a filename.
  const filename = `${doc.docNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
