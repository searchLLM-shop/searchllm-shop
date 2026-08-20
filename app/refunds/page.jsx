import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Cancellation & Refunds — SearchLLM" };

const CONTENT = `SearchLLM Plus is a yearly subscription to a digital service. There is no physical product and nothing is shipped.

CANCELLATION

Plus is a one-time yearly payment, not a recurring subscription — it does not auto-renew, and you will never be charged again automatically once your year of access has been paid for. There is no future billing to cancel out of, because none is scheduled.

At the end of your paid year, the account automatically reverts to the Free plan, which continues to work at the free daily limit, unless you choose to upgrade again.

If you would rather stop using Plus before your year is up, email us at the address on our Contact page with the email address on your account, and we will turn it off early.

REFUNDS

If you are charged in error — for example a duplicate charge, or a charge after you cancelled — we will refund it in full. Contact us and we will resolve it.

If you are unhappy with the service within 7 days of your first payment, contact us and we will refund that payment in full, no explanation needed.

Beyond that window, we do not refund partial years, because you keep access for the full period you paid for. If something has gone genuinely wrong, contact us anyway — we would rather sort it out than argue over a year's fee.

HOW REFUNDS ARE PAID

Approved refunds are returned to the original payment method through Razorpay, our payment processor. Banks typically take 5–7 working days to show the credit, though it is sometimes faster.

We do not store your card or banking details at any point. Payments and refunds are handled entirely by Razorpay.`;

export default function Page() {
  return <LegalPage title="Cancellation & Refunds" updated="July 2026">{CONTENT}</LegalPage>;
}
