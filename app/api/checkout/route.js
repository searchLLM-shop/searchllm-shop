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

  // Name the missing piece rather than failing opaquely — "Payments not
  // configured" gave no way to tell which of the three values was absent.
  const missing = [
    !keyId && "RAZORPAY_KEY_ID",
    !keySecret && "RAZORPAY_KEY_SECRET",
    !planId && "RAZORPAY_PLAN_ID",
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

  // Recharge: a ONE-TIME payment (₹249 → unlock the current search block),
  // via a Razorpay Payment Link — distinct from the Plus subscription flow
  // below. The unlock itself happens only in the webhook on
  // payment_link.paid, same never-trust-the-redirect rule as Plus.
  let rechargeBody = null;
  try { rechargeBody = await req.json(); } catch {}
  if (rechargeBody?.type === "recharge") {
    try {
      const { RECHARGE_PRICE_INR } = (await import("@/lib/constants")).LOYALTY;
      const resp = await fetch("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
        },
        body: JSON.stringify({
          amount: RECHARGE_PRICE_INR * 100, // paise
          currency: "INR",
          description: "SearchLLM recharge — 50 more picks",
          customer: email ? { email } : undefined,
          notes: { clerkUserId: userId, type: "recharge" },
          callback_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://searchllm.shop"}/?recharged=1`,
          callback_method: "get",
        }),
      });
      const link = await resp.json();
      if (!resp.ok || !link.short_url) {
        console.error("Recharge link failed:", JSON.stringify(link).slice(0, 300));
        return Response.json({ error: "Could not start the recharge" }, { status: 502 });
      }
      return Response.json({ url: link.short_url });
    } catch (err) {
      console.error("Recharge checkout failed:", err);
      return Response.json({ error: "Could not start the recharge" }, { status: 502 });
    }
  }

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
      const body = await resp.text();
      console.error("Razorpay subscription create failed:", resp.status, body);
      let detail = `Razorpay returned ${resp.status}`;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error?.description) detail = parsed.error.description;
      } catch { /* keep the status-code fallback */ }
      return Response.json({ error: "Unable to start checkout", detail }, { status: 502 });
    }

    const sub = await resp.json();
    // short_url is Razorpay's hosted payment page for this subscription.
    return Response.json({ url: sub.short_url });
  } catch (err) {
    console.error("Razorpay checkout error:", err);
    return Response.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
