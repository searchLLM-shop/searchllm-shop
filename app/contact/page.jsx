import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Contact Us — SearchLLM" };

// NOTE: update these details to your real registered business details before
// submitting the site to Razorpay — their review checks that contact
// information is present, reachable, and matches the registered entity.
const CONTENT = `We read everything that comes in and reply to support questions within two working days.

COMPANY

piBits AI Solutions Pvt Ltd
Noida, Uttar Pradesh, India

EMAIL

Support, billing, privacy and legal: deploy@pibitsai.com

For anything about a charge, a refund, or cancelling your subscription, please write from the email address on your account so we can find it quickly.

FOR BRANDS AND RETAILERS

If you want your products considered, use the "For Brands" tab on the site. Submissions go through the same human review as everything else, and paying us does not buy a recommendation — we say so publicly because we mean it.

A NOTE ON WHAT WE CAN HELP WITH

We are a research service, not a retailer. We do not sell, ship, or handle any product. If your question is about an order you placed — where it is, what arrived, a refund or a return — that has to go to the retailer you bought from. We have no access to their systems and cannot act on your behalf.`;

export default function Page() {
  return <LegalPage title="Contact Us" updated="July 2026">{CONTENT}</LegalPage>;
}
