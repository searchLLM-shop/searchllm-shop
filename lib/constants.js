// lib/constants.js — shared across server and client components.
// SEED_LISTINGS below is now superseded by the database (see schema.sql).
// ALTERNATIVES_POOL is still used client-side for the "we also considered"
// comparison until that logic is also moved server-side (a reasonable next
// iteration once real listing volume makes a static pool insufficient).

// Set to true once payments are live to reveal the Upgrade button. The Plus
// tier is fully built — it's hidden rather than removed so it can be switched
// on without a code change once Razorpay is sorted and there's evidence of
// what people actually want to pay for.
// Upgrade is ON: Plus (₹499/year via Razorpay) is now the redemption key
// for the rewards programme — points accumulate free, redeem paid.
// OPERATIONAL PREREQUISITE: RAZORPAY_WEBHOOK_SECRET must be set in Vercel
// (Razorpay dashboard → webhook) or payments succeed without the plan ever
// flipping to plus.
export const SHOW_UPGRADE = true;

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

// Loyalty programme economics. The load-bearing rule: points derive from
// commission the network CONFIRMS — a percentage of real revenue, never a
// flat per-order amount — so the programme cannot pay out more than it
// earns, whatever gets bought. Rates are generous on purpose while volumes
// are tiny; tune down later if needed. INR only for now: mixing currencies
// into one points balance would be dishonest arithmetic.
export const LOYALTY = {
  // --- Purchase points (self-funding: a share of confirmed commission) ---
  POINTS_RATE: 0.4,          // points per ₹1 of network-CONFIRMED commission
  PLUS_MULTIPLIER: 2,        // Plus members earn double on purchases
  POINT_VALUE_INR: 1,        // 1 point = ₹1 of voucher value

  // --- Engagement points (marketing spend: NOT self-funding) ---
  // Guests: a day-expiring teaser, real cost zero (they vanish at midnight
  // unless the person registers, which is the entire psychological point).
  // Registered users: every pick earns, no separate cap — the daily pick
  // quota IS the ceiling (decision 2026-07-23). Note the interaction this
  // creates: Plus has unlimited picks, so a determined Plus user can grind
  // search points; the Terms' anti-automation clause is the backstop, and
  // these rates are the tuning lever if grinding shows up in the reports.
  // Affiliate clicks earn more than picks — rewarding the action closest to
  // revenue — credited once per product per day (see creditClickPoints),
  // because uncapped identical clicks would be a self-service points mint.
  SEARCH_POINTS: {
    GUEST_PER_PICK: 10,      // shown as "expiring today" — converts on signup
    USER_PER_PICK: 5,        // every pick, bounded only by the pick quota
    CLICK_POINTS: 5,         // per affiliate-link click, once per product/day
  },

  // --- Engagement cap and lifecycle gates ---
  // Engagement points (picks + clicks) stop at 250 LIFETIME — exactly one
  // voucher's worth. Beyond that only confirmed purchases earn, which caps
  // the maximum grinding liability per user at ₹250, once, ever. The
  // lifecycle gates ask engaged non-buyers WHY at every block: feedback
  // unlocks the next block free (their answer is worth more than ₹249),
  // paying skips the form. A single confirmed purchase exempts a user from
  // all gates for life — shoppers are never interrogated.
  ENGAGEMENT_POINTS_LIFETIME_CAP: 250,
  // Per-cycle gates (a cycle = since last purchase or recharge). Plus gets
  // HIGHER allowances, not unlimited (decision 2026-07-23) — the numbers
  // are shown at upgrade time and in the Terms. Both gates BLOCK: picks
  // stop at the search limit, affiliate clicks stop at the click limit,
  // until a purchase or an Increase Usage payment resets the cycle.
  GATE_LIMITS: {
    free: { searches: 50, clicks: 25 },
    plus: { searches: 200, clicks: 100 },
  },
  // Network-level fair use, rolling 30 days, hashed IPs. Deliberately more
  // generous than account limits (shared carrier IPs), and anyone who has
  // EVER paid or purchased is exempt — evasion control must never punish a
  // paying customer on office Wi-Fi.
  IP_GATE: { windowDays: 30, searches: 120, clicks: 60 },
  RECHARGE_PRICE_INR: 249,

  // --- Redemption (Plus members only) ---
  // The higher tiers (2000/5000) exist for the travel brands — a ₹5,000
  // MakeMyTrip voucher is a real aspiration target, which is exactly what a
  // visible-to-everyone prize wall needs at the top. All brands technically
  // accept all denominations under manual fulfilment.
  DENOMINATIONS: [250, 500, 1000, 2000, 5000],
  VOUCHER_CATALOG: [
    { brand: "Amazon Pay", category: "Shopping" },
    { brand: "Flipkart", category: "Shopping" },
    { brand: "Myntra", category: "Fashion" },
    { brand: "Swiggy", category: "Food" },
    { brand: "MakeMyTrip", category: "Travel" },
    { brand: "Yatra", category: "Travel" },
    { brand: "Uber", category: "Travel" },
    { brand: "BookMyShow", category: "Entertainment" },
  ],
};

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
Unregistered users: your query text is processed to answer your question. We also keep the text of search queries in a strictly anonymous log — never linked to you, your account, your session, or your device — so we can see which products people are looking for and add coverage for them. The only context stored with a logged query is your approximate country and whether we had a relevant product to show. Queries blocked by our content filter are never stored at all.
Registered users: your email address, your plan tier, and a daily count of how many searches you have run. Authentication is handled by our identity provider; we never see or store your password.
We do not build a profile of your shopping history, and we do not track you across other websites.

4. WE DO NOT SHARE YOUR DATA — WITH ANYONE
We do not sell, rent, licence or trade your personal data. We do not share it with brands, advertisers, affiliate networks, data brokers, or any other third party for their own purposes.
This includes our affiliate partners. A brand listed on this site never receives your identity, your email address, your query text, or any means of identifying you individually. When you click an affiliate link, the destination retailer and the affiliate network see that a click occurred from our site — they do not receive anything from us about who you are or what you searched for.
The only parties who process data on our behalf are the infrastructure providers strictly required to run the service (hosting, database, authentication, payment processing, and the AI model that generates recommendations). They act on our instructions and may not use your data for their own purposes.

5. WHAT WE STORE ABOUT YOUR SEARCHES
Two things, both designed so they cannot be traced back to you:
An anonymised knowledge record of questions asked, to improve future answers. Your raw question is not stored against it — only a one-way hash, which cannot be reversed to recover what you typed or linked back to you.
An anonymous log of search query text, used solely to understand which products to add to the site. No user, account, session or device identifier is ever attached to it — the log is built without one, so it cannot become a history of anyone's searches.

6. PAYMENTS
Subscription payments are processed by Razorpay. We never see or store your card, UPI or bank details at any point. Razorpay handles that under its own privacy policy.

6A. REWARDS PROGRAMME (OPT-IN ONLY)
Everything above describes the default: no purchase history, ever. The rewards programme is the single, explicit exception, and it exists only for members who join it. Search points (earned per research pick) involve no new data: they are computed from the same anonymous-at-rest usage counters described above; guest search points are never stored at all — they are calculated from the day's pick count and cease to exist at midnight. Purchase points are different: when you join, purchases you make through our links while signed in are linked to your account via the partner network's sale confirmations, so your points can be calculated. What we store for members: which of your clicks led to a confirmed sale, the product, and the commission-derived points — never your payment details, which we never see. When a voucher redemption is fulfilled through a gift-card provider, we share with that provider only what issuance requires. Non-members and guests are completely unaffected. You can stop at any time by contacting us: accrual stops immediately; the existing ledger is retained as accounting records. This section only applies if you have explicitly joined the programme from the Rewards page.

6AB. TRAFFIC AND ADVERTISING MEASUREMENT
We use industry-standard tag tooling (Google Tag Manager) for two narrow purposes. First, traffic measurement via Google Analytics: aggregate counts of visits, pages viewed, and on-site actions such as "a search completed" or "a product link was clicked" — configured with Google's advertising features (Google Signals, ads personalisation, demographic reporting) disabled, and never including your query text or personal identifiers in events. Second, when we run advertising campaigns, measurement of whether our own ads led to visits — for example a Meta (Facebook/Instagram) pixel that tells Meta "this ad click resulted in a visit". Neither is used to build profiles of your browsing on other websites, and we do not load cross-site remarketing or third-party advertising audiences. These tools may set cookies from the respective provider; you can block them with standard browser controls without affecting the service.

6B. FAIR-USE ENFORCEMENT DATA
To enforce the usage limits in our Terms and to prevent abuse through multiple accounts, we process your network (IP) address in one-way hashed form: the hash lets us count recent usage per network address, but the raw address is not stored with this data and the hash cannot be reversed into it. These counters are kept for the rolling enforcement window plus a short margin and are used for no other purpose — not for advertising, not for profiling, and never shared. Accounts with a completed purchase or Increase Usage payment are exempt from network-level limits.

7. DATA RETENTION
Session data is deleted when your session ends. Account data is kept while your account is active and deleted within 30 days of a deletion request. Anonymously logged query text (section 5) is retained as aggregate product-demand data; because it carries no identifier, it is not linked to any person and cannot be selectively deleted per person — there is nothing connecting it to you to delete.

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
(a) medicines of any kind, over-the-counter or prescription — health decisions belong with a doctor or a licensed pharmacist, and we do not research, recommend, or link to medicines. Non-medicinal wellness products (vitamins, supplements, personal care) are supported;
(b) sexual or adult products, pornography, sexual services, escort services, dating or companionship services, or any sexually explicit material. Sexual-wellness health products (condoms, lubricants, intimate hygiene) are ordinary purchases and are permitted;
(c) any sexual content involving or referencing minors — such attempts are refused outright, access is terminated, and where the law requires we report;
(d) obscene, indecent, or vulgar content of any kind;
(e) profanity, slurs, hate speech, harassment, or abusive language;
(f) illegal drugs, controlled substances, or drug paraphernalia;
(g) tobacco, vaping and nicotine products, gambling or betting services, or the purchase of alcohol;
(h) weapons, ammunition, explosives, or items designed to cause harm;
(i) counterfeit, stolen, or illegally traded goods;
(j) anything unlawful under Indian law or the law applying where you are.
We do not support or facilitate any of the above. Queries in these categories are refused with an explanation, and we may suspend or terminate access for repeated attempts, without refund.

6A. REWARDS PROGRAMME
The rewards programme is optional and free to join for registered users. Points accrue in the following ways: (i) engagement points per research pick and per recommended-product link click, subject to the limits and per-day rules we set (guest engagement points expire the same day unless you register and claim them); and (ii) purchase points calculated from commissions that partner stores confirm to us for purchases made through our links after you joined. Points carry no cash value, are not transferable, and accumulate without expiry for registered members; REDEEMING points is a benefit of the paid Plus plan, in the fixed voucher denominations we list, at 1 point = ₹1 of voucher value. Purchase points confirm only after the store approves the sale (typically 30–90 days) and are reversed if an order is returned, cancelled, or the commission is declined. We may adjust earning rates, caps, denominations and voucher options prospectively (never removing already-confirmed points), and may withhold or void points obtained through fraud, automated or manipulative searching, self-dealing, or abuse. The programme may be modified or discontinued with reasonable notice; confirmed points will remain redeemable for a wind-down period in that event.

6B. POINTS AND VOUCHERS — WHAT WE ARE AND ARE NOT RESPONSIBLE FOR
Points are promotional credits within this service only. They are not money, a deposit, a wallet balance, or a prepaid payment instrument of any kind; they cannot be withdrawn, transferred, or converted to cash, and "1 point = ₹1" expresses only the exchange rate at which points convert into voucher denominations — nothing more.
Gift vouchers are products of their respective issuing brands. When you redeem points, our responsibility is to deliver you a genuine, unused voucher code of the denomination requested. If a code is invalid at the moment of delivery, report it within 7 days and we will replace it or re-credit your points — that is the full extent of our voucher obligation. From delivery onward, everything about the voucher — activation, validity period, expiry, usage conditions, balance, partial redemption, and any dispute — is governed by the issuing brand's own terms and is a matter between you and that brand (and its issuer). We are not the issuer of any voucher and accept no liability for a brand's refusal to honour, changes to its voucher terms, or the closure of its voucher programme.
Brand names shown in the voucher catalogue are trademarks of their respective owners; their appearance means only that vouchers for those brands are available for redemption, not that any brand sponsors, endorses, or is affiliated with this service.

6BB. AMAZON ASSOCIATES
SearchLLM.shop is a participant in the Amazon Associates Program. As an Amazon Associate, we earn from qualifying purchases made through clearly-labelled Amazon links on this site. Such links lead directly to Amazon; purchases, pricing, delivery and returns are governed by Amazon's own terms.

6C. FAIR USE AND USAGE LIMITS
Every research pick runs paid AI computation. Usage therefore works in cycles, where a cycle restarts with every completed purchase we can reconcile with our partner networks (and every Increase Usage payment). Within a cycle, checkpoints apply when usage shows sustained value without any movement toward a purchase: 50 picks or 50 alternative-suggestion clicks without a single recommended-product (affiliate) click, a hard ceiling of twice the pick allowance regardless, or 25 recommended-product clicks without a completed purchase. At the first checkpoint in a cycle, free users and guests are shown an upgrade invitation and may continue after acknowledging it; at a subsequent checkpoint in the same cycle, continued research requires an Increase Usage payment at the price shown in the product (currently ₹249). Plus subscribers are never blocked from research: at these checkpoints, alternative (non-affiliate) suggestions are withheld from their answers instead, and are restored by a completed purchase. Feedback is welcome at any checkpoint and genuinely read, but does not extend usage.
To keep these limits meaningful, usage is also monitored per network address in privacy-preserving hashed form (see the Privacy Policy). Creating multiple accounts, rotating identities, or otherwise circumventing usage limits is prohibited; limits may be enforced at the network level, and circumvention may lead to suspension without refund. Network-level limits do not apply to any account that has completed a purchase or an Increase Usage payment.

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

