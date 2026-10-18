// app/api/admin/payments/[id]/pdf/route.js
//
// Admin download of any member's receipt / tax invoice as a PDF (the member's
// own copy is /api/payments/[id]/pdf). Admin only.

import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdminUser } from "@/lib/isAdmin";
import { getPaymentDocumentById } from "@/lib/db";
import { supplierConfig } from "@/lib/gst";
import { buildInvoicePdf } from "@/lib/invoicePdf";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return new Response("Not signed in", { status: 401 });
  if (!isAdminUser(await currentUser())) return new Response("Forbidden", { status: 403 });

  const docId = Number.parseInt(id, 10);
  if (!Number.isInteger(docId)) return new Response("Not found", { status: 404 });
  const doc = await getPaymentDocumentById(docId);
  if (!doc) return new Response("Not found", { status: 404 });

  const pdf = buildInvoicePdf(doc, supplierConfig());
  const filename = `${doc.docNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
