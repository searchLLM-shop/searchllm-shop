// app/api/checkout/route.js
//
// Creates a Razorpay Subscription for the Plus plan and returns its
// hosted payment page URL (short_url) — same redirect contract the UI
// already expects ({ url }), so page.jsx needed no changes.
//
// Razorpay replaced Stripe here because Stripe is invite-only for new
// Indian businesses; Razorpay is INR-native and supports UPI/netbanking.
//
// The actual plan upgrade happens ONLY in the webhook
// (app/api/razorpay/webhook/route.js) once Razorpay confirms payment —
// never trust the redirect back to the site as proof of payment.

import { auth, currentUser } from "@clerk/nextjs/server";

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const planId = process.env.RAZORPAY_PLAN_ID;
  if (!keyId || !keySecret || !planId) {
    return Response.json({ error: "Payments not configured" }, { status: 500 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  try {
    const resp = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
      },
      body: JSON.stringify({
        plan_id: planId,
        // Number of billing cycles to authorize. 60 = five years of a
        // monthly plan; adjust to your plan's period in the dashboard.
        total_count: 60,
        customer_notify: 1,
        // clerkUserId in notes is how the webhook knows which user to
        // upgrade — Razorpay echoes notes back in every subscription event.
        notes: { clerkUserId: userId, email: email || "" },
      }),
    });

    if (!resp.ok) {
      console.error("Razorpay subscription create failed:", resp.status, await resp.text());
      return Response.json({ error: "Unable to start checkout" }, { status: 502 });
    }

    const sub = await resp.json();
    // short_url is Razorpay's hosted payment page for this subscription.
    return Response.json({ url: sub.short_url });
  } catch (err) {
    console.error("Razorpay checkout error:", err);
    return Response.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
