import LegalPage from "@/components/LegalPage";
import { LOYALTY } from "@/lib/constants";

export const metadata = { title: "Cancellation & Refunds — SearchLLM" };

export default function Page() {
  const block = LOYALTY.POINTS_BLOCK_SIZE;
  const fee = LOYALTY.PLATFORM_FEE_INR;
  const CONTENT = `SearchLLM's platform fee is a one-off digital payment, charged per ${block}-point block. There is no physical product and nothing is shipped.

CANCELLATION

There is nothing to cancel: the platform fee is not a subscription and does not auto-renew. Each ₹${fee} payment unlocks exactly one ${block}-point block — you only ever pay again when you choose to fill and pay for another block. Researching itself is always free and is never gated by this payment.

REFUNDS

If you are charged in error — for example a duplicate charge for the same block — we will refund it in full. Contact us and we will resolve it.

If you are unhappy with a block you just paid for and have not yet redeemed a voucher against it, contact us within 7 days of that payment and we will refund it in full, no explanation needed.

Beyond that window, or once a voucher from that block has been issued, we do not refund the platform fee, because the block's earning ceiling has already been lifted and its value delivered. If something has gone genuinely wrong, contact us anyway — we would rather sort it out than argue over ₹${fee}.

HOW REFUNDS ARE PAID

Approved refunds are returned to the original payment method through Razorpay, our payment processor. Banks typically take 5–7 working days to show the credit, though it is sometimes faster.

We do not store your card or banking details at any point. Payments and refunds are handled entirely by Razorpay.`;
  return <LegalPage title="Cancellation & Refunds" updated="August 2026">{CONTENT}</LegalPage>;
}
