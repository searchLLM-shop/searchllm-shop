// app/points/page.jsx — "How points work": the public, plain-language
// explanation of the rewards programme. Every number renders from the same
// LOYALTY config the engine uses, so this page can never drift from reality.
//
// Flat platform-fee model (2026-08-25): no Plus plan, no Increase Usage.
// Points build up free from zero but pause at every POINTS_BLOCK_SIZE
// boundary until that block's PLATFORM_FEE_INR is paid — a one-way ratchet
// that unlocks that block's voucher and lets earning carry on.

import { LOYALTY } from "@/lib/constants";

export const metadata = {
  title: "How points work — SearchLLM",
  description: "Earn points on every pick and every recommended-product click. 1 point = ₹1 of gift voucher value.",
};

export default function PointsPage() {
  const p = LOYALTY.POINTS;
  const block = LOYALTY.POINTS_BLOCK_SIZE;
  const fee = LOYALTY.PLATFORM_FEE_INR;
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px", lineHeight: 1.8, fontSize: 14, color: "var(--color-text-primary)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>How points work</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 28 }}>
        Simple version: research and clicking recommended products both earn points, everyone earns the same rate, and 1 point is always worth ₹1 of gift voucher value. Every {block} points is one flat ₹{fee} platform fee away from a voucher.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Earning</h2>
      <p><strong>Every pick you research</strong> earns points. As a guest you collect {p.GUEST_PER_PICK} points per pick, plus points for any click — but all of it expires at midnight unless you register that day. Sign up (free) and the day&apos;s points are yours to keep; signed-in members earn {p.SEARCH} points on every pick. <strong>Clicking a recommended product link earns {p.CLICK} points</strong> — once per product per day.</p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Purchases earn no points, and this is deliberate, not an oversight: we only credit a point when we can genuinely verify the action ourselves, and a purchase confirmation depends on the affiliate network reporting it back to us — something we currently cannot verify reliably enough across every store to promise it honestly. Points are credited immediately for search and click activity; there is no pending or waiting period.
      </p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Worth being direct about, separately: brands don&apos;t pay to be featured or clicked, and we only earn anything ourselves when you actually buy — the pick you&apos;re shown is decided before commission ever enters the picture. That has nothing to do with your points balance; it&apos;s simply how the business behind this stays honest.
      </p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Points build up free from zero, but pause at every {block}-point mark — {block}, {block * 2}, {block * 3}, and so on — until you pay a flat ₹{fee} platform fee for that specific block. There&apos;s no subscription and no upgrade tier: it&apos;s the same ₹{fee} every {block}-point cycle, for every account. Paying unlocks that block&apos;s voucher for redemption and lets earning carry on into the next block — once paid, a block never re-locks. Researching itself is never blocked by this; only new points pause at an unpaid ceiling.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Redeeming</h2>
      <p>Once a block is paid for, whatever balance is available in it is yours to redeem, whenever you like. Vouchers come in fixed denominations — {LOYALTY.DENOMINATIONS.map((d) => `₹${d}`).join(" / ")} — across {LOYALTY.VOUCHER_CATALOG.map((v) => v.brand).join(", ")}. Because gift vouchers are regulated in India, issuing one requires your first name, last name, mobile number, email and postal address — required by the RBI, not something we chose. Your name and mobile are the ones already on your account from sign-up, shown locked at redemption (change them in your account profile, not on the redemption form); email and address are the two things you provide and confirm fresh every time, since sign-up itself never collects an email address. Request a redemption from your Rewards tab and the voucher code appears there, usually within 2 working days.</p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Worked example: 30 searches and 10 clicks in a cycle earns {30 * p.SEARCH + 10 * p.CLICK} points — right around the {block}-point mark. Pay the ₹{fee} platform fee once that block is full, and that voucher is yours; keep going and the next {block} points build the same way.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>The voucher wall</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "12px 0" }}>
        {Object.entries(LOYALTY.VOUCHER_CATALOG.reduce((acc, v) => { (acc[v.category] = acc[v.category] || []).push(v.brand); return acc; }, {})).map(([category, brands]) => (
          <div key={category} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "12px 14px", background: "var(--color-background-secondary)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#854F0B", marginBottom: 6 }}>{category}</div>
            <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.6 }}>{brands.join(" · ")}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        Denominations: {LOYALTY.DENOMINATIONS.map((d) => `₹${d.toLocaleString()}`).join(" · ")} — the higher tiers are where the travel vouchers shine.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>The fine print, plainly</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Points have no cash value and aren&apos;t transferable. We may tune earning rates, the block size, or the platform fee going forward (never retroactively taking confirmed points), and points obtained through fraud or self-dealing are void. Vouchers themselves are the issuing brand&apos;s product — once your code is delivered (we replace codes invalid on arrival, reported within 7 days), its use and validity follow that brand&apos;s own terms. Full terms in our <a href="/terms" style={{ color: "#0F6E56" }}>Terms of Use</a>; what joining means for your data is in the <a href="/privacy" style={{ color: "#0F6E56" }}>Privacy Policy</a> — short version: your purchases are never linked to your points balance at all.
      </p>

      <p style={{ marginTop: 30 }}>
        <a href="/" style={{ color: "#0F6E56", fontWeight: 500 }}>← Back to research</a>
      </p>
    </main>
  );
}
