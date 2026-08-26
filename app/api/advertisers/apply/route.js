// Public advertiser application. Creates a pending advertiser record; nothing
// goes live until an admin approves it.
import { createAdvertiser, getAdvertiserByEmail } from "@/lib/db";

export async function POST(req) {
  try {
    const b = await req.json();
    if (!b.companyName || !b.website || !b.contactEmail) {
      return Response.json({ error: "Company name, website and email are required" }, { status: 400 });
    }
    try { new URL(b.website); } catch {
      return Response.json({ error: "Website must be a full URL, e.g. https://example.com" }, { status: 400 });
    }
    const existing = await getAdvertiserByEmail(b.contactEmail);
    if (existing) {
      return Response.json({ error: "An application already exists for this email." }, { status: 409 });
    }
    const rate = Number(b.commissionRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return Response.json({ error: "Please propose a commission rate" }, { status: 400 });
    }
    // Length caps (matching the pattern already used in /api/brands) — this
    // form has no admin gate in front of it, so an unbounded string field
    // is an open row-bloat/storage-cost vector, not just a UI nicety.
    const adv = await createAdvertiser({
      companyName: String(b.companyName).slice(0, 200),
      website: String(b.website).slice(0, 500),
      contactName: b.contactName ? String(b.contactName).slice(0, 200) : null,
      contactEmail: String(b.contactEmail).slice(0, 200),
      phone: b.phone ? String(b.phone).slice(0, 30) : null,
      gstNumber: b.gstNumber ? String(b.gstNumber).slice(0, 20) : null,
      billingAddress: b.billingAddress ? String(b.billingAddress).slice(0, 500) : null,
      commissionModel: b.commissionModel,
      commissionRate: rate,
      currency: b.currency,
    });
    return Response.json({ id: adv.id, status: adv.status });
  } catch (err) {
    console.error("Advertiser application failed:", err);
    return Response.json({ error: "Could not submit application", detail: String(err?.message || err) }, { status: 500 });
  }
}
