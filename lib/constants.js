// lib/constants.js — shared across server and client components.
// SEED_LISTINGS below is now superseded by the database (see schema.sql).
// ALTERNATIVES_POOL is still used client-side for the "we also considered"
// comparison until that logic is also moved server-side (a reasonable next
// iteration once real listing volume makes a static pool insufficient).

// Set to true once payments are live to reveal the Upgrade button. The Plus
// tier is fully built — it's hidden rather than removed so it can be switched
// on without a code change once Razorpay is sorted and there's evidence of
// what people actually want to pay for.
export const SHOW_UPGRADE = false;

// The direct-advertiser programme is built but not launched. Focus for now is
// users and the established affiliate networks; this switches on the public
// application form and the advertiser dashboard when we're ready to sell.
export const SHOW_ADVERTISERS = false;

// The old "For Brands" form pointed at affiliate networks, which most direct
// brands aren't on. Superseded by the advertiser programme above.
export const SHOW_BRANDS_FORM = false;

// German-market support (UI translations, German AI answers, German legal
// pages, German keyword enrichment) is built but PAUSED until the German
// legal work is validated — the Impressum is missing (§5 TMG) and the legal
// translations are unreviewed, both of which carry Abmahnung risk if the site
// is directed at the German market. While false, every visitor gets English.
// The translations and legalDe.js are kept intact so this is a one-line
// re-enable once a German-qualified review has happened.
export const ENABLE_GERMAN = false;

// AI keyword enrichment burned real money rewriting keywords for hundreds of
// thousands of feed products whose titles are already descriptive — the
// mechanical deriveKeywords() plus Postgres full-text search (search_tsv in
// findCandidateListings) match those fine at zero marginal cost. While this
// is false the hourly enrichment cron is a no-op (its vercel.json entry is
// also removed); the MANUAL "Generate keywords" admin button still works, so
// a deliberate, bounded run over the handful of listings that genuinely need
// it — affiliate-jargon campaign titles like "Trunativ.co Ecommerce CPS" —
// is one click and roughly one API call, not an unattended standing spend.
export const ENABLE_AI_KEYWORDS = false;

export const PLANS = {
  free: {
    name: "Free",
    searches: 8,
    savedPicks: 20,
    price: 0,
    features: ["8 picks a day", "Top pick + alternatives", "Save up to 20 picks"],
  },
  plus: {
    name: "Plus",
    searches: -1,      // unlimited
    savedPicks: -1,    // unlimited
    price: 500,        // INR per month
    features: ["Unlimited picks", "Unlimited saved picks", "Price-drop alerts (soon)"],
  },
};

export const ALTERNATIVES_POOL = [
  { name: "REI Co-op Rainier rain jacket", price: "$110", note: "cheaper, heavier fabric, no pit zips", sponsored: false },
  { name: "Patagonia Torrentshell 3L", price: "$179", note: "similar weight, better known brand, less packable", sponsored: false },
  { name: "Arc'teryx Beta LT", price: "$400", note: "best-in-class but more than double the price for most hikers' needs", sponsored: false },
  { name: "Sony WH-CH720N", price: "$99", note: "cheaper, noticeably weaker ANC", sponsored: false },
  { name: "Sennheiser Accentum", price: "$179", note: "better mic quality, $50 more", sponsored: false },
  { name: "La Roche-Posay Anthelios", price: "$36", note: "stronger SPF formula, more expensive, slight white cast", sponsored: false },
  { name: "Osprey Talon 33", price: "$150", note: "more durable build, heavier, costs more", sponsored: false },
];

export const PRIVACY_POLICY = `Privacy Policy — SearchLLM.shop
Operated by piBits AI Solutions Pvt Ltd, Noida, India
Last updated: July 2026

1. WHO WE ARE
SearchLLM.shop is operated by piBits AI Solutions Pvt Ltd, Noida, India. Contact us at deploy@pibitsai.com for any question about this policy, your data, or your account.

2. WHAT THIS SITE DOES
We research a shopping question, give you one clear pick with the reasoning behind it, and show the alternatives we did not pick and why. Some results include a brand we have an affiliate relationship with, tracked through a third-party network (Awin, Impact, or vCommission). We label every one of those clearly. Payment never changes which option we rank as the best pick — an affiliate relationship only determines whether a tracked link may appear beneath a recommendation that exists independently of it.

3. WHAT WE COLLECT
Unregistered users: your query text for the current session only. It is not stored after the session ends.
Registered users: your email address, your plan tier, and a daily count of how many searches you have run. Authentication is handled by our identity provider; we never see or store your password.
We do not build a profile of your shopping history, and we do not track you across other websites.

4. WE DO NOT SHARE YOUR DATA — WITH ANYONE
We do not sell, rent, licence or trade your personal data. We do not share it with brands, advertisers, affiliate networks, data brokers, or any other third party for their own purposes.
This includes our affiliate partners. A brand listed on this site never receives your identity, your email address, your query text, or any means of identifying you individually. When you click an affiliate link, the destination retailer and the affiliate network see that a click occurred from our site — they do not receive anything from us about who you are or what you searched for.
The only parties who process data on our behalf are the infrastructure providers strictly required to run the service (hosting, database, authentication, payment processing, and the AI model that generates recommendations). They act on our instructions and may not use your data for their own purposes.

5. WHAT WE STORE ABOUT YOUR SEARCHES
We keep an anonymised knowledge record of questions asked, to improve future answers. Your raw question is not stored against it — only a one-way hash, which cannot be reversed to recover what you typed or linked back to you.

6. PAYMENTS
Subscription payments are processed by Razorpay. We never see or store your card, UPI or bank details at any point. Razorpay handles that under its own privacy policy.

7. DATA RETENTION
Session data is deleted when your session ends. Account data is kept while your account is active and deleted within 30 days of a deletion request.

8. YOUR RIGHTS
You can request a copy of your data, correction of it, or its deletion at any time by emailing deploy@pibitsai.com. We will respond within 30 days.

9. SECURITY
Data is encrypted in transit and at rest. No system is perfectly secure, and we do not claim otherwise, but we do not retain the kinds of data that would make a breach materially damaging to you.

10. CHANGES
Registered users receive 30 days' notice by email before any material change to this policy.`;

export const TERMS = `Terms of Use — SearchLLM.shop
Operated by piBits AI Solutions Pvt Ltd, Noida, India
Last updated: July 2026

1. WHAT YOU ARE AGREEING TO
By using SearchLLM.shop, whether registered or not, you agree to these terms. If you do not agree, please do not use the service. The service is operated by piBits AI Solutions Pvt Ltd, Noida, India ("we", "us").

2. WHAT THIS SERVICE IS — AND IS NOT
We provide AI-generated shopping research and product comparisons.
We are NOT a retailer, seller, distributor, importer, or agent of any brand. We do not sell, stock, ship, or handle any product. We do not process product orders. Every purchase takes place directly between you and the retailer, on the retailer's own website, under the retailer's own terms and conditions.

3. AI-GENERATED CONTENT — VERIFY BEFORE YOU BUY
Recommendations on this site are generated by an artificial intelligence model. AI CAN AND DOES MAKE MISTAKES. Answers may be incomplete, out of date, or simply wrong — including product specifications, prices, availability, compatibility, safety information, and whether a product exists at all.
You must independently verify anything that matters to you — particularly price, availability, specifications, warranty, and suitability for your needs — on the retailer's own page before purchasing. Do not rely on this service as your only source for any decision involving health, safety, legal, financial or medical consequences. Where such matters are involved, consult a qualified professional.

4. NO LIABILITY FOR PRODUCTS, RETAILERS, OR DELIVERY
We show and refer to products sold by third parties. We do not control, inspect, test, endorse, or guarantee any of them.
To the fullest extent permitted by law, we accept no liability whatsoever for:
(a) any product shown, referred to, recommended, linked, or advertised on this site;
(b) the quality, safety, authenticity, legality, condition, or fitness for purpose of any product;
(c) whether a product is delivered at all, when it is delivered, what is actually delivered, or the condition it arrives in;
(d) any counterfeit, defective, damaged, expired, recalled, or misdescribed goods;
(e) pricing errors, stock errors, or changes made by the retailer after our recommendation was generated;
(f) any act, omission, or failure of any retailer, brand, marketplace, courier, or payment provider;
(g) any loss, injury, illness, damage, or expense arising from the purchase or use of any product;
(h) refunds, returns, replacements, warranty claims, or after-sales service of any kind.
All of the above are matters between you and the retailer, governed by that retailer's terms. Any dispute about a product or an order must be raised with the retailer directly.

5. HONEST RECOMMENDATION COMMITMENT
We commit to never ranking a sponsored product above an unsponsored one because of payment. A sponsored listing must be genuinely relevant to your query to appear at all, and is always labelled. If you believe we have failed this, write to deploy@pibitsai.com and we will investigate and respond within 5 business days.

6. ACCEPTABLE USE — PROHIBITED CONTENT AND CONDUCT
This is a general-audience shopping research service. You may not use it to search for, request, or attempt to obtain:
(a) sexual or adult products, pornography, sexual services, escort services, or any sexually explicit material;
(b) obscene, indecent, or vulgar content of any kind;
(c) profanity, slurs, hate speech, harassment, or abusive language;
(d) illegal drugs, controlled substances, or drug paraphernalia;
(e) weapons, ammunition, explosives, or items designed to cause harm;
(f) counterfeit, stolen, or illegally traded goods;
(g) anything unlawful under Indian law or the law applying where you are.
We do not support or facilitate any of the above. Queries of this nature will be refused, and we may suspend or terminate access for repeated attempts, without refund.
You also may not scrape the site, reverse engineer the recommendation model, or use automation to evade usage limits.

7. FREE AND PAID PLANS
Free plan: a limited number of picks per day, resetting at 00:00 UTC. Plus plan: unlimited picks, billed monthly through Razorpay, cancellable at any time and effective at the end of the billing period already paid for. See our Cancellation & Refunds page.

8. BRAND LISTINGS
Brands may submit products for affiliate placement, subject to human review before going live. Acceptance is not a guarantee of a recommendation, and payment does not buy one. We are not a party to any transaction between you and a brand.

9. DISCLAIMER OF WARRANTIES
The service is provided "as is" and "as available", without warranty of any kind, express or implied, including any warranty of accuracy, merchantability, or fitness for a particular purpose. We do not warrant that the service will be uninterrupted, error-free, or that any recommendation will be accurate or suitable for you.

10. LIMITATION OF LIABILITY
To the fullest extent permitted by law, our total aggregate liability to you for any claim arising out of or relating to the service is limited to the amount you paid us in the twelve months preceding the claim, or INR 1,000, whichever is lower. We are not liable for any indirect, incidental, special, consequential, punitive, or exemplary damages, or for any loss of profit, revenue, data, or goodwill, however arising.
Nothing in these terms excludes any liability that cannot lawfully be excluded.

11. INDEMNITY
You agree to indemnify and hold harmless piBits AI Solutions Pvt Ltd, its directors, employees and agents against any claim, loss, or expense arising from your misuse of the service or your breach of these terms.

12. GOVERNING LAW
These terms are governed by the laws of India. The courts at Noida, Uttar Pradesh have exclusive jurisdiction over any dispute.

13. CONTACT
piBits AI Solutions Pvt Ltd, Noida, India — deploy@pibitsai.com`;

