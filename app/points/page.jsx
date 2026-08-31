// app/points/page.jsx — "How points work": the public, plain-language
// explanation of the rewards programme. Every number renders from the same
// LOYALTY config the engine uses, so this page can never drift from reality.

import { LOYALTY, planPriceLabel } from "@/lib/constants";

export const metadata = {
  title: "How points work — SearchLLM",
  description: "Earn points on every pick and every confirmed purchase. 1 point = ₹1 of gift voucher value.",
};

export default function PointsPage() {
  const p = LOYALTY.POINTS;
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px", lineHeight: 1.8, fontSize: 14, color: "var(--color-text-primary)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>How points work</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 28 }}>
        Simple version: research earns a little, buying earns more, everyone earns the same rate, and 1 point is always worth ₹1 of gift voucher value.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Earning</h2>
      <p><strong>Every pick you research</strong> earns points. As a guest you collect {p.GUEST_PER_PICK} points per pick, plus points for any click and same-day-confirmed purchase — but all of it expires at midnight unless you register that day. Sign up (free) and the day&apos;s points are yours to keep; signed-in members earn {p.SEARCH} points on every pick. <strong>Clicking a recommended product link earns {p.CLICK} points</strong> — once per product per day, because the click is the step closest to a real purchase.</p>
      <p><strong>Every confirmed purchase earns {p.PURCHASE} points</strong> — the same amount whatever the order size, and the same for every member, free or Plus.</p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Purchase points appear as <em>pending</em> first and <em>confirm</em> once the store approves the sale — typically 30–90 days after purchase, because stores wait out the return window. Returned or cancelled orders don&apos;t earn. This is the honest mechanics of how affiliate commissions work, and we&apos;d rather tell you than surprise you.
      </p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Worth being direct about: it&apos;s <em>you</em> being rewarded, not the seller. No brand pays us to feature them or to earn you points — the pick you&apos;re shown is decided before commission ever enters the picture. We only earn anything at all once you actually complete a purchase, and points are simply our sharing that with you.
      </p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        On a free account, points stop at {LOYALTY.VOUCHER_UNLOCK_POINTS} — you won&apos;t lose anything you&apos;ve earned, but nothing further is credited (search, click, or purchase) until you upgrade to Plus. Plus removes that ceiling entirely.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Redeeming</h2>
      <p>Once your total reaches {LOYALTY.VOUCHER_UNLOCK_POINTS} points, you&apos;re eligible to pay for Plus ({planPriceLabel()}) — which both lifts the earning ceiling and lets you redeem your first voucher. <strong>Redeeming, and earning past {LOYALTY.VOUCHER_UNLOCK_POINTS}, are both Plus benefits.</strong> Vouchers come in fixed denominations — {LOYALTY.DENOMINATIONS.map((d) => `₹${d}`).join(" / ")} — across {LOYALTY.VOUCHER_CATALOG.map((v) => v.brand).join(", ")}. Because gift vouchers are regulated in India, redeeming one asks for your first name, last name, mobile number, email and address every time, even if it&apos;s the same as last time — required by the RBI, not something we chose. Request a redemption from your Rewards tab and the voucher code appears there, usually within 2 working days.</p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Once you&apos;re Plus, keep researching freely — the only thing to know is that {LOYALTY.PLUS_QUERY_CYCLE_LIMIT} picks with no purchase in between triggers an Increase Usage payment (₹{LOYALTY.RECHARGE_PRICE_INR}) to keep going; a single purchase resets that count for free, and this can happen more than once across the year.
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
        Points have no cash value and aren&apos;t transferable. Purchase points reverse if the order is returned or the commission is declined. We may tune earning rates and voucher options going forward (never retroactively taking confirmed points), and points obtained through fraud or self-dealing are void. Vouchers themselves are the issuing brand&apos;s product — once your code is delivered (we replace codes invalid on arrival, reported within 7 days), its use and validity follow that brand&apos;s own terms. Full terms in our <a href="/terms" style={{ color: "#0F6E56" }}>Terms of Use</a>; what joining means for your data is in the <a href="/privacy" style={{ color: "#0F6E56" }}>Privacy Policy</a> — short version: purchases are only linked to your account if you explicitly join the programme.
      </p>

      <p style={{ marginTop: 30 }}>
        <a href="/" style={{ color: "#0F6E56", fontWeight: 500 }}>← Back to research</a>
      </p>
    </main>
  );
}
