import LegalPage from "@/components/LegalPage";
import { PLANS } from "@/lib/constants";

export const metadata = { title: "Pricing — SearchLLM" };

const NOTES = `WHAT YOU ARE PAYING FOR

SearchLLM gives you one honest shopping recommendation per question, with the reasoning behind it, who it suits, who should skip it, and the alternatives we considered.

Where we have an affiliate relationship with a retailer, that option is labelled as sponsored and shown separately from the recommendation itself. Paying for Plus does not change which products we recommend, and it never has.

BILLING

Plus is billed monthly in Indian Rupees through Razorpay. The subscription renews automatically each month until you cancel. You can cancel at any time — see our Cancellation & Refunds page.

Prices shown include applicable taxes where required. You will receive an email receipt from Razorpay for every payment.

There is no setup fee, no minimum term, and no charge for the Free plan.`;

export default function Page() {
  return (
    <LegalPage title="Pricing" updated="July 2026">
      <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
        {Object.entries(PLANS).map(([key, plan]) => (
          <div key={key} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 10, padding: "16px 18px", background: "var(--color-background-secondary)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{plan.name}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#0F6E56" }}>
                {plan.price === 0 ? "Free" : `₹${plan.price}/month`}
              </span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {plan.features.map((f) => <li key={f} style={{ marginBottom: 3 }}>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>
      {NOTES}
    </LegalPage>
  );
}
