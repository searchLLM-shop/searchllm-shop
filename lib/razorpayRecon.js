// lib/razorpayRecon.js
//
// Reads captured payments from Razorpay's own API so the admin can check
// our payment documents against Razorpay's records: money Razorpay took that
// we have no document for (a webhook that never arrived), and documents with
// no matching Razorpay payment. Read-only — nothing here writes to Razorpay.

const PAGE = 100;
const MAX_PAGES = 5; // up to 500 payments per check

export async function fetchRazorpayPayments({ fromUnix, toUnix }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay keys are not configured");
  const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const items = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.razorpay.com/v1/payments?from=${fromUnix}&to=${toUnix}&count=${PAGE}&skip=${page * PAGE}`;
    const resp = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Razorpay ${resp.status}: ${body.slice(0, 160)}`);
    }
    const data = await resp.json();
    const batch = data.items || [];
    items.push(...batch);
    if (batch.length < PAGE) break;
  }
  return items.map((p) => ({
    id: p.id,
    amountPaise: p.amount,
    status: p.status,
    captured: p.captured === true || p.status === "captured",
    method: p.method || null,
    contact: p.contact || null,
    email: p.email || null,
    createdAt: new Date(p.created_at * 1000).toISOString(),
  }));
}

// Compares our documents with Razorpay's captured payments for the window.
export function reconcile(documents, rzpPayments) {
  const captured = rzpPayments.filter((p) => p.captured && p.status === "captured");
  const rzpById = new Map(captured.map((p) => [p.id, p]));
  const docById = new Map(documents.map((d) => [d.paymentId, d]));

  const missingInOurRecords = captured.filter((p) => !docById.has(p.id));
  const notInRazorpay = documents.filter((d) => !rzpById.has(d.paymentId));
  const amountMismatch = documents
    .filter((d) => rzpById.has(d.paymentId) && rzpById.get(d.paymentId).amountPaise !== d.amountPaise)
    .map((d) => ({ documentId: d.id, docNumber: d.docNumber, paymentId: d.paymentId, ourPaise: d.amountPaise, razorpayPaise: rzpById.get(d.paymentId).amountPaise }));

  return {
    razorpayCaptured: captured.length,
    razorpayCapturedPaise: captured.reduce((s, p) => s + p.amountPaise, 0),
    matched: captured.length - missingInOurRecords.length,
    missingInOurRecords,
    notInRazorpay,
    amountMismatch,
  };
}
