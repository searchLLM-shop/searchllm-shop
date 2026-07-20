// app/api/track/conversion/route.js
//
// Conversion postback. The advertiser calls this from their order-confirmation
// page (or server) when a sale completes:
//
//   GET /api/track/conversion
//         ?click_id=<the click_id we appended to the destination URL>
//         &order_id=<their order reference>
//         &value=<order value>
//         &secret=<the advertiser's postback secret>
//
// The secret prevents a third party fabricating or suppressing sales. The
// unique constraint on (advertiser_id, order_id) prevents an order being
// counted twice, whether by accident or otherwise.

import { getClick, recordConversion } from "@/lib/db";

function respond(ok, message, status = 200) {
  return Response.json({ ok, message }, { status });
}

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const clickId = p.get("click_id");
  const secret = p.get("secret");
  const orderId = p.get("order_id");
  const value = p.get("value");

  if (!clickId || !secret) return respond(false, "click_id and secret are required", 400);

  const click = await getClick(clickId);
  if (!click) return respond(false, "Unknown click_id", 404);
  if (click.postback_secret !== secret) return respond(false, "Invalid secret", 403);

  // Attribution window: a click older than the agreed cookie period no longer
  // earns commission. Stated up front so it can't become a dispute later.
  const ageDays = (Date.now() - new Date(click.clicked_at).getTime()) / 86400000;
  if (ageDays > (click.cookie_days || 30)) {
    return respond(false, `Click is outside the ${click.cookie_days}-day attribution window`, 200);
  }

  const orderValue = Number(value);
  const commission =
    click.commission_model === "cps"
      ? (Number.isFinite(orderValue) ? (orderValue * Number(click.commission_rate)) / 100 : 0)
      : Number(click.commission_rate);

  const created = await recordConversion({
    clickId,
    advertiserId: click.advertiser_id,
    orderId,
    orderValue: Number.isFinite(orderValue) ? orderValue : null,
    commission: Math.round(commission * 100) / 100,
  });

  if (!created) return respond(true, "Already recorded (duplicate order_id)");
  return respond(true, "Conversion recorded");
}

// Some platforms can only send POST — accept both.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  for (const k of ["click_id", "secret", "order_id", "value"]) {
    if (body[k] != null) url.searchParams.set(k, String(body[k]));
  }
  return GET(new Request(url.toString(), { headers: req.headers }));
}
