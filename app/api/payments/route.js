// app/api/payments/route.js
//
// The signed-in shopper's own receipts / tax invoices for platform-fee
// payments, newest first. Each links to /invoice/[id], a printable page.
// Never returns another user's documents: everything is keyed on the
// session's user id.

import { auth } from "@clerk/nextjs/server";
import { listPaymentDocuments } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ documents: [] }, { status: 401 });
  try {
    const documents = await listPaymentDocuments(userId);
    return Response.json({ documents });
  } catch (err) {
    console.error("Payments list failed:", err.message);
    return Response.json({ documents: [] });
  }
}
