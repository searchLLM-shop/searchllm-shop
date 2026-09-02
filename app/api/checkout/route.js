// app/api/checkout/route.js
//
// Creates a Razorpay Payment Link for the platform fee — the ONLY payment
// this app takes now (2026-08-25: the Plus subscription and Increase Usage
// were both removed; one flat fee per 250-point block replaced them, see
// LOYALTY.PLATFORM_FEE_INR in lib/constants.js). A payment link, not a
// subscription — this was never recurring in spirit and now isn't even in
// mechanism.
//
// The actual block unlock happens ONLY in the webhook
// (app/api/razorpay/webhook/route.js) once Razorpay confirms payment —
// never trust the redirect back to the site as proof of payment.

import { auth, currentUser } from "@clerk/nextjs/server";
import { LOYALTY } from "@/lib/constants";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // Name the missing piece rather than failing opaquely — "Payments not
  // configured" gave no way to tell which of the two values was absent.
  const missing = [
    !keyId && "RAZORPAY_KEY_ID",
    !keySecret && "RAZORPAY_KEY_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    console.error("Razorpay not configured — missing:", missing.join(", "));
    return Response.json(
      { error: "Payments not configured", detail: `Missing in Vercel: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  try {
    const resp = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
      },
      body: JSON.stringify({
        amount: LOYALTY.PLATFORM_FEE_INR * 100, // paise
        currency: "INR",
        description: `SearchLLM platform fee — unlock your next ${LOYALTY.POINTS_BLOCK_SIZE} points`,
        customer: email ? { email } : undefined,
        // clerkUserId + type are how the webhook knows which user paid for
        // what — Razorpay echoes notes back on payment_link.paid.
        notes: { clerkUserId: userId, type: "platform_fee" },
        callback_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://searchllm.shop"}/?feePaid=1`,
        callback_method: "get",
      }),
    });
    const link = await resp.json();
    if (!resp.ok || !link.short_url) {
      console.error("Platform fee link failed:", JSON.stringify(link).slice(0, 300));
      return Response.json({ error: "Could not start the payment" }, { status: 502 });
    }
    return Response.json({ url: link.short_url });
  } catch (err) {
    console.error("Platform fee checkout failed:", err);
    return Response.json({ error: "Could not start the payment" }, { status: 502 });
  }
}
