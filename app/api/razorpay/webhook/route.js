// app/api/razorpay/webhook/route.js
//
// The ONLY place a user's plan actually changes — verified against
// Razorpay's HMAC signature so a user can't fake an upgrade by visiting
// a success URL. Configure in the Razorpay dashboard:
//   Settings -> Webhooks -> Add:  https://searchllm.shop/api/razorpay/webhook
//   Subscribe to: subscription.activated, subscription.charged,
//                 subscription.cancelled, subscription.halted,
//                 subscription.completed
// and set the same secret in RAZORPAY_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from "crypto";
import { upsertUserPlan, resolveCheckpoint } from "@/lib/db";

const UPGRADE_EVENTS = ["subscription.activated", "subscription.charged"];
const DOWNGRADE_EVENTS = ["subscription.cancelled", "subscription.halted", "subscription.completed", "subscription.paused"];

export async function POST(req) {
  const signature = req.headers.get("x-razorpay-signature");
  const rawBody = await req.text();

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) {
    return Response.json({ error: "Webhook not configured" }, { status: 400 });
  }

  // Razorpay signs the raw body with HMAC-SHA256 (hex). Compare in
  // constant time to avoid timing attacks.
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.error("Razorpay webhook signature verification failed");
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawBody);
    const type = event.event;
    const sub = event.payload?.subscription?.entity;
    const userId = sub?.notes?.clerkUserId;

    // Recharge: one-time payment link paid → mark the user's CURRENT search
    // block as paid-resolved, unlocking the next 50 picks. Idempotent by
    // the (user, kind, block) unique key, so webhook retries no-op.
    if (type === "payment_link.paid") {
      const pl = body?.payload?.payment_link?.entity;
      const rechargeUser = pl?.notes?.clerkUserId;
      if (rechargeUser && pl?.notes?.type === "recharge") {
        try {
          // The paid row's timestamp IS the new anchor — counters restart.
          await resolveCheckpoint(rechargeUser, "search", "paid");
        } catch (err) {
          console.error("Recharge unlock failed:", err.message);
        }
      }
      return Response.json({ ok: true });
    }

    if (userId && UPGRADE_EVENTS.includes(type)) {
      await upsertUserPlan({ userId, plan: "plus", subscriptionId: sub.id });
    } else if (userId && DOWNGRADE_EVENTS.includes(type)) {
      await upsertUserPlan({ userId, plan: "free", subscriptionId: sub.id });
    }
    // Other events are fine to ignore.
  } catch (err) {
    console.error("Razorpay webhook handler error:", err);
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
