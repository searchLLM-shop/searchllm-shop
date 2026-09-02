// app/api/razorpay/webhook/route.js
//
// The ONLY place a platform-fee payment actually unlocks a points block —
// verified against Razorpay's HMAC signature so a user can't fake a
// payment by visiting a success URL. Configure in the Razorpay dashboard:
//   Settings -> Webhooks -> Add:  https://searchllm.shop/api/razorpay/webhook
//   Subscribe to: payment_link.paid
// and set the same secret in RAZORPAY_WEBHOOK_SECRET.
//
// (2026-08-25: this used to also handle Plus subscription events —
// subscription.activated/charged/cancelled/etc. Both the Plus plan and the
// Increase Usage mechanism this webhook previously unlocked are gone,
// replaced by the single flat platform fee below. Nothing subscription-
// related is created anymore, so there's nothing left to subscribe those
// events to — payment_link.paid is now the only event this needs.)

import { createHmac, timingSafeEqual } from "crypto";
import { payPlatformFeeBlock } from "@/lib/db";

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

    if (type === "payment_link.paid") {
      const pl = event.payload?.payment_link?.entity;
      const userId = pl?.notes?.clerkUserId;
      if (userId && pl?.notes?.type === "platform_fee") {
        try {
          // Idempotent by the (user, kind, block) unique key underneath
          // resolveCheckpoint, so a webhook retry just no-ops rather than
          // unlocking a second block for one payment.
          await payPlatformFeeBlock(userId);
        } catch (err) {
          console.error("Platform fee unlock failed:", err.message);
        }
      }
    }
    // Other events are fine to ignore.
  } catch (err) {
    console.error("Razorpay webhook handler error:", err);
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
