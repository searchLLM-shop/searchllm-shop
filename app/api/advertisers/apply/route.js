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
    const adv = await createAdvertiser({ ...b, commissionRate: rate });
    return Response.json({ id: adv.id, status: adv.status });
  } catch (err) {
    console.error("Advertiser application failed:", err);
    return Response.json({ error: "Could not submit application", detail: String(err?.message || err) }, { status: 500 });
  }
}
