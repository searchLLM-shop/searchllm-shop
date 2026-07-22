// app/points/page.jsx — "How points work": the public, plain-language
// explanation of the rewards programme. Every number renders from the same
// LOYALTY config the engine uses, so this page can never drift from reality.

import { LOYALTY } from "@/lib/constants";

export const metadata = {
  title: "How points work — SearchLLM",
  description: "Earn points on every pick and every confirmed purchase. 1 point = ₹1 of gift voucher value.",
};

export default function PointsPage() {
  const sp = LOYALTY.SEARCH_POINTS;
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px", lineHeight: 1.8, fontSize: 14, color: "var(--color-text-primary)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>How points work</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 28 }}>
        Simple version: research earns a little, buying earns more, and 1 point is always worth ₹1 of gift voucher value.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Earning</h2>
      <p><strong>Every pick you research</strong> earns points. As a guest you collect {sp.GUEST_PER_PICK} points per pick — but guest points expire at midnight. Sign up (free) and the day&apos;s points are yours to keep; signed-in members earn {sp.USER_PER_PICK} points per pick, up to {sp.USER_DAILY_CAP} a day.</p>
      <p><strong>Every purchase counts more.</strong> When you buy through one of our recommendation links and the store confirms the sale, you earn points based on the commission the store pays us — with no daily cap. Plus members earn {LOYALTY.PLUS_MULTIPLIER}× on purchases.</p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Purchase points appear as <em>pending</em> first and <em>confirm</em> once the store approves the sale — typically 30–90 days after purchase, because stores wait out the return window. Returned or cancelled orders don&apos;t earn. This is the honest mechanics of how affiliate commissions work, and we&apos;d rather tell you than surprise you.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Redeeming</h2>
      <p>Points accumulate free, forever, for every signed-in member. <strong>Redeeming them is a Plus benefit</strong> (₹499/year, which also gives unlimited picks and the {LOYALTY.PLUS_MULTIPLIER}× purchase multiplier). Vouchers come in fixed denominations — {LOYALTY.DENOMINATIONS.map((d) => `₹${d}`).join(" / ")} — across {LOYALTY.VOUCHER_CATALOG.map((v) => v.brand).join(", ")}. Request a redemption from your Rewards tab and the voucher code appears there, usually within 2 working days.</p>

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
