// Advertiser-facing: add products and see performance. An advertiser is
// identified by the email on their signed-in account matching their record.
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getAdvertiserByEmail, addAdvertiserProduct, getAdvertiserProducts, getAdvertiserStats,
} from "@/lib/db";

async function advertiserFor() {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) return null;
  return getAdvertiserByEmail(email);
}

export async function GET() {
  const adv = await advertiserFor();
  if (!adv) return Response.json({ error: "No advertiser account for this login" }, { status: 403 });
  const [products, stats] = await Promise.all([
    getAdvertiserProducts(adv.id),
    getAdvertiserStats(adv.id),
  ]);
  return Response.json({
    advertiser: {
      id: adv.id, companyName: adv.company_name, status: adv.status,
      commissionModel: adv.commission_model, commissionRate: adv.commission_rate,
      currency: adv.currency, cookieDays: adv.cookie_days,
      postbackSecret: adv.postback_secret,
    },
    products, stats,
  });
}

export async function POST(req) {
  const adv = await advertiserFor();
  if (!adv) return Response.json({ error: "No advertiser account for this login" }, { status: 403 });
  if (adv.status !== "approved") {
    return Response.json({ error: "Your account is still under review." }, { status: 403 });
  }
  const b = await req.json();
  if (!b.productName || !b.destinationUrl) {
    return Response.json({ error: "Product name and destination URL are required" }, { status: 400 });
  }
  try { new URL(b.destinationUrl); } catch {
    return Response.json({ error: "Destination URL must be a full URL" }, { status: 400 });
  }
  const product = await addAdvertiserProduct(adv.id, b);
  return Response.json({ product });
}
