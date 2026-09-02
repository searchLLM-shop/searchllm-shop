import LegalPage from "@/components/LegalPage";
import { LOYALTY } from "@/lib/constants";

export const metadata = { title: "Pricing — SearchLLM" };

const NOTES = `WHAT YOU ARE PAYING FOR

SearchLLM gives you one honest shopping recommendation per question, with the reasoning behind it, who it suits, who should skip it, and the alternatives we considered — free, unlimited, for every signed-in account.

Where we have an affiliate relationship with a retailer, that option is labelled as sponsored and shown separately from the recommendation itself. The platform fee does not change which products we recommend, and it never has.

BILLING

The platform fee is billed once per 250-point block, in Indian Rupees through Razorpay. There is no subscription, no auto-renewal, and no ongoing mandate — each payment is a one-off charge for the block you've just filled. Prices shown include applicable taxes where required. You will receive an email receipt from Razorpay for every payment.

There is no setup fee and no minimum term. Researching is always free — see our Cancellation & Refunds page for what's refundable.`;

export default function Page() {
  const block = LOYALTY.POINTS_BLOCK_SIZE;
  const fee = LOYALTY.PLATFORM_FEE_INR;
  return (
    <LegalPage title="Pricing" updated="August 2026">
      <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
        <div style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 10, padding: "16px 18px", background: "var(--color-background-secondary)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>Researching</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#0F6E56" }}>Free</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            <li style={{ marginBottom: 3 }}>Unlimited picks a day when signed in (8 a day as a guest)</li>
            <li style={{ marginBottom: 3 }}>Top pick + alternatives</li>
            <li style={{ marginBottom: 3 }}>Save up to 20 picks</li>
            <li style={{ marginBottom: 3 }}>Earn {LOYALTY.POINTS.SEARCH} points per pick, {LOYALTY.POINTS.CLICK} per recommended-product click</li>
          </ul>
        </div>
        <div style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 10, padding: "16px 18px", background: "var(--color-background-secondary)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>Platform fee</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#0F6E56" }}>₹{fee} / {block}-point block</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            <li style={{ marginBottom: 3 }}>No plan, no upgrade tier — the same flat fee for every account, every cycle</li>
            <li style={{ marginBottom: 3 }}>Points earn freely from 0, pausing at each {block}-point mark until that block&apos;s fee is paid</li>
            <li style={{ marginBottom: 3 }}>Paying unlocks that block&apos;s ₹{block} voucher and lets earning carry on into the next block</li>
            <li style={{ marginBottom: 3 }}>Researching itself is never gated by this — only new points pause at an unpaid ceiling</li>
          </ul>
        </div>
      </div>
      {NOTES}
    </LegalPage>
  );
}
