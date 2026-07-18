// components/LegalPage.jsx
//
// Shared shell for the standalone policy pages. These exist as real URLs
// (not just modals) because payment providers — Razorpay among them —
// verify that a merchant's website has reachable policy pages before
// approving it, and because a shopper deserves to be able to link to and
// re-read them without starting a session.

import Link from "next/link";

export default function LegalPage({ title, updated, children }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "8px 4px 48px" }}>
      <Link href="/" style={{ fontSize: 12, color: "#0F6E56", textDecoration: "none" }}>
        ← Back to SearchLLM
      </Link>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: "18px 0 4px" }}>{title}</h1>
      {updated && (
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "0 0 20px" }}>
          Last updated {updated}
        </p>
      )}
      <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>
        {children}
      </div>
      <hr style={{ border: "none", borderTop: "0.5px solid var(--color-border-tertiary)", margin: "32px 0 16px" }} />
      <p style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
        Questions? <Link href="/contact" style={{ color: "#0F6E56" }}>Contact us</Link> ·{" "}
        <Link href="/privacy" style={{ color: "#0F6E56" }}>Privacy</Link> ·{" "}
        <Link href="/terms" style={{ color: "#0F6E56" }}>Terms</Link> ·{" "}
        <Link href="/refunds" style={{ color: "#0F6E56" }}>Refunds</Link> ·{" "}
        <Link href="/pricing" style={{ color: "#0F6E56" }}>Pricing</Link>
      </p>
    </main>
  );
}
