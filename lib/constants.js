// lib/constants.js — shared across server and client components.
// SEED_LISTINGS below is now superseded by the database (see schema.sql).
// ALTERNATIVES_POOL is still used client-side for the "we also considered"
// comparison until that logic is also moved server-side (a reasonable next
// iteration once real listing volume makes a static pool insufficient).

// Set to true once payments are live to reveal the Upgrade button. The Plus
// tier is fully built — it's hidden rather than removed so it can be switched
// on without a code change once Razorpay is sorted and there's evidence of
// what people actually want to pay for.
// Upgrade is ON: Plus (price defined in PLANS below, charged via the
// Razorpay plan in RAZORPAY_PLAN_ID) is now the redemption key
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

// Loyalty programme economics (redesigned 2026-08-25, per explicit direction:
// flat, equal-for-everyone points — no commission-scaling, no Plus multiplier,
// no earning cap). NOTE this is a deliberate move away from the previous
// "self-funding" rule (points as a share of confirmed commission) — purchase
// points are now a fixed 25 regardless of order size or margin. That is a
// real liability-per-purchase change (a ₹50 order and a ₹50,000 order both
// earn 25 points), accepted explicitly by the business, not a coding default.
// INR only: mixing currencies into one points balance would be dishonest
// arithmetic.
export const LOYALTY = {
  POINT_VALUE_INR: 1,        // 1 point = ₹1 of voucher value

  // --- Flat points, identical for every user (free or Plus) ---
  // Guest search points are still a day-expiring teaser (never stored —
  // computed live, vanish at midnight unless the person registers).
  // Registered search/click points are now UNCAPPED — no lifetime ceiling,
  // no plan multiplier (see creditSearchPoints/creditClickPoints/
  // syncLoyaltyLedger in lib/db.js). Click points are still credited once
  // per product per day, because uncapped identical clicks would be a
  // self-service points mint.
  POINTS: {
    GUEST_PER_PICK: 10,      // shown as "expiring today" — converts on signup
    SEARCH: 5,                // every research pick, registered users
    CLICK: 5,                 // per affiliate-link click, once per product/day
    PURCHASE: 25,             // per network-confirmed purchase, any order size
  },

  // Reaching this many TOTAL points (search + click + purchase, combined,
  // uncapped) is what makes a registered user eligible to pay for Plus and
  // redeem a voucher — a reward-driven nudge, not a forced/automatic gate.
  // Redemption itself still requires the Plus plan (see requestRedemption).
  VOUCHER_UNLOCK_POINTS: 250,

  // Plus-only usage cycle (redesigned 2026-08-25): a cycle = since the last
  // confirmed purchase, Increase Usage payment, or the most recent Plus
  // upgrade, whichever is latest. A Plus member who makes this many queries
  // with ZERO purchases in that window must pay Increase Usage to continue;
  // a purchase resets the cycle for free. This can repeat all year. Free
  // users and guests are never blocked by this — the old free-tier
  // query/click checkpoint ladder is gone entirely.
  PLUS_QUERY_CYCLE_LIMIT: 25,

  // Network-level fair use, rolling 30 days, hashed IPs. Deliberately more
  // generous than account limits (shared carrier IPs), and anyone who has
  // EVER paid or purchased is exempt — evasion control must never punish a
  // paying customer on office Wi-Fi. Independent of the cycle gate above.
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

// THE DAILY PICK RULE, in one place so the header, the quota check and the
// pricing copy can never disagree (redesigned 2026-08-25, replacing the old
// "250 points hit → 8 a day returns" leverage, which was part of the forced
// free-tier gate this redesign removes):
//
//   guest        → 8 a day. Registering is the way out.
//   signed in    → no daily cap, permanently, free or Plus. The only
//                  remaining cost backstops are LOYALTY.IP_GATE (network-
//                  level fair use) and the Terms' anti-automation clause;
//                  Plus additionally has the per-cycle Increase Usage gate
//                  (LOYALTY.PLUS_QUERY_CYCLE_LIMIT, enforced in
//                  getLifecycleStatus, not here).
//   admin        → no daily cap.
export function dailyPickLimit({ signedIn, plan, isAdmin = false }) {
  if (isAdmin) return -1;
  if (plan === "plus") return PLANS.plus.searches;
  if (!signedIn) return PLANS.free.searches;
  return -1;
}

// Renders the price consistently wherever an upgrade is offered.
export function planPriceLabel(plan = "plus") {
  const p = PLANS[plan];
  if (!p || !p.price) return "";
  return `₹${p.price}/${p.period || "month"}`;
}

export const PLANS = {
  free: {
    name: "Free",
    searches: 8,
    savedPicks: 20,
    price: 0,
    features: ["Unlimited picks a day when signed in (8 a day as a guest)", "Top pick + alternatives", "Save up to 20 picks"],
  },
  plus: {
    name: "Plus",
    searches: -1,      // unlimited
    savedPicks: -1,    // unlimited
    // SINGLE SOURCE OF TRUTH for what Plus costs. It must match the plan
    // configured in Razorpay (RAZORPAY_PLAN_ID) — the charge comes from
    // there, not from here, so a mismatch means the site advertises one
    // price and bills another. Every upgrade prompt renders planPriceLabel()
    // rather than a hardcoded string, after a period where the pricing page
    // said "₹500/month" while the rewards copy said "₹499/year" and they'd
    // drifted apart. ₹499/year is correct — it was the original plan from
    // the start (2026-08-20 confirmed): the business runs on affiliate
    // revenue, so Plus is priced low-friction/annual, not a real monthly
    // subscription line item. Do not "fix" this back to ₹500/month.
    price: 499,        // INR
    period: "year",    // "month" | "year"
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
Last updated: August 2026

1. WHO WE ARE
SearchLLM.shop is operated by piBits AI Solutions Pvt Ltd, Noida, India. Contact us at deploy@pibitsai.com for any question about this policy, your data, or your account.

2. WHAT THIS SITE DOES
We research a shopping question, give you one clear pick with the reasoning behind it, and show the alternatives we did not pick and why. Some results include a brand we have an affiliate relationship with, tracked through a third-party network (Awin, Impact, or vCommission). We label every one of those clearly. Payment never changes which option we rank as the best pick — an affiliate relationship only determines whether a tracked link may appear beneath a recommendation that exists independently of it.

3. WHAT WE COLLECT
Unregistered users: your query text is processed to answer your question. We also keep the text of search queries in a strictly anonymous log — never linked to you, your account, your session, or your device — so we can see which products people are looking for and add coverage for them. The only context stored with a logged query is your approximate country and whether we had a relevant product to show. Queries blocked by our content filter are never stored at all.
Registered users: your email address and/or mobile number (whichever you sign up with), your plan tier, and a daily count of how many searches you have run. Authentication is handled by our identity provider, including sending any verification code to confirm you own the email or mobile number you registered with; we never see or store your password.
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
Everything above describes the default: no purchase history, ever. The rewards programme is the single, explicit exception, and it exists only for members who join it. Search and click points involve no new data: they are computed from the same anonymous-at-rest usage counters described above, at a flat rate that is the same for every member, and are not scaled by anything about the purchase. Guest search points are never stored at all — they are calculated from the day's pick count and cease to exist at midnight. Purchase points are different: when you join, purchases you make through our links while signed in are linked to your account via the partner network's sale confirmations, so your points can be calculated (a fixed number of points per confirmed purchase, the same for every member and every order size). What we store for members: which of your clicks led to a confirmed sale, the product, and the points earned — never your payment details, which we never see. When a voucher redemption is fulfilled through a gift-card provider, we share with that provider only what issuance requires. Non-members and guests are completely unaffected. You can stop at any time by contacting us: accrual stops immediately; the existing ledger is retained as accounting records. This section only applies if you have explicitly joined the programme from the Rewards page.

6AC. GIFT VOUCHER KYC (RBI MANDATE)
Redeeming points for a gift voucher is a separate, further step members take, and it requires additional information: your full name, mobile number, email address and postal address. This is not a choice we made — it follows Reserve Bank of India requirements for the issuance of prepaid instruments (gift vouchers) in India, and a voucher cannot legally be issued to you without it. These details are stored against your account so we don't ask twice from scratch, but they are always shown back to you and must be explicitly reconfirmed at the moment of every redemption, including when they haven't changed — a fresh, dated confirmation record is kept with each redemption for this reason. This information is used solely to fulfil your voucher order (and, where the issuing gift-card provider requires it, passed to them for that purpose) — never for marketing, never shared with any advertiser or affiliate partner, and never used outside the redemption it was collected for. You can review or correct what's on file, or ask what's been kept against past redemptions, the same way as any other data request in section 8.

6AA. LIVE WEB LOOKUPS
To answer with current prices and current reviews rather than an AI model's stale recollection, we look your question up on the live web before answering. This means the text of your question — and sometimes a product name from our catalogue — is sent to a third-party search provider, which processes it under its own terms. We send nothing else: not your account, your email, your identity, or anything about your other queries. Nothing about you is retained by us as a result of this lookup beyond what is described elsewhere in this policy.

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
Last updated: August 2026

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
This is an AI shopping answer engine, and the integrity of the answer is the product. Our recommendations are not confined to the products, brands, or affiliate partners listed on this platform: where the honest answer is a product we do not carry and earn nothing from, that is the answer you get, and where no product we carry genuinely fits your question, we say so rather than offering one. The AI that writes your answer is never told what we earn on anything.
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
The rewards programme is optional and free to join for registered users. Points accrue at a flat rate, the same for every member whether or not you are on the Plus plan: a fixed number of points per research pick, per recommended-product link click (subject to the once-per-product-per-day rule we set; guest points expire the same day unless you register and claim them), and a fixed number of points per confirmed purchase — the same amount whatever the order's value — calculated from commissions that partner stores confirm to us for purchases made through our links after you joined. Points carry no cash value, are not transferable, and accumulate without expiry or limit for registered members. Reaching the points total shown in the Rewards tab (currently 250) makes you eligible to pay for Plus and claim your first voucher; REDEEMING points into a voucher is a benefit of the paid Plus plan, in the fixed voucher denominations we list, at 1 point = ₹1 of voucher value. Purchase points confirm only after the store approves the sale (typically 30–90 days) and are reversed if an order is returned, cancelled, or the commission is declined. We may adjust earning rates, denominations and voucher options prospectively (never removing already-confirmed points), and may withhold or void points obtained through fraud, automated or manipulative searching, self-dealing, or abuse. The programme may be modified or discontinued with reasonable notice; confirmed points will remain redeemable for a wind-down period in that event.

6B. POINTS AND VOUCHERS — WHAT WE ARE AND ARE NOT RESPONSIBLE FOR
Points are promotional credits within this service only. They are not money, a deposit, a wallet balance, or a prepaid payment instrument of any kind; they cannot be withdrawn, transferred, or converted to cash, and "1 point = ₹1" expresses only the exchange rate at which points convert into voucher denominations — nothing more.
Gift vouchers are products of their respective issuing brands. When you redeem points, our responsibility is to deliver you a genuine, unused voucher code of the denomination requested. If a code is invalid at the moment of delivery, report it within 7 days and we will replace it or re-credit your points — that is the full extent of our voucher obligation. From delivery onward, everything about the voucher — activation, validity period, expiry, usage conditions, balance, partial redemption, and any dispute — is governed by the issuing brand's own terms and is a matter between you and that brand (and its issuer). We are not the issuer of any voucher and accept no liability for a brand's refusal to honour, changes to its voucher terms, or the closure of its voucher programme.
Brand names shown in the voucher catalogue are trademarks of their respective owners; their appearance means only that vouchers for those brands are available for redemption, not that any brand sponsors, endorses, or is affiliated with this service.

6BB. AMAZON ASSOCIATES
SearchLLM.shop is a participant in the Amazon Associates Program. As an Amazon Associate, we earn from qualifying purchases made through clearly-labelled Amazon links on this site. Such links lead directly to Amazon; purchases, pricing, delivery and returns are governed by Amazon's own terms.

6BC. GIFT VOUCHER KYC (RBI MANDATE)
Redeeming points for a gift voucher requires you to provide, and to explicitly confirm at the time of every redemption, your full name, mobile number, email address and postal address — a requirement of Reserve Bank of India rules for the issuance of gift vouchers in India, not a policy we have discretion over. We store these details against your account so they can be shown back to you and reused on later redemptions, but each redemption still requires its own fresh confirmation, even when nothing has changed. Providing inaccurate details is your responsibility: we are not liable for a voucher misdelivered or misissued because the information you confirmed was wrong. See the Privacy Policy for how this information is stored and used.

6C. FAIR USE AND USAGE LIMITS
Every research pick runs paid AI computation. Registered users, free or Plus, have no daily limit on picks (guests may make up to 8 a day). For Plus subscribers only, usage also works in a cycle: a cycle restarts with every completed purchase we can reconcile with our partner networks and with every Increase Usage payment. Within a cycle, ${LOYALTY.PLUS_QUERY_CYCLE_LIMIT} research picks with no completed purchase in between requires an Increase Usage payment (currently ₹${LOYALTY.RECHARGE_PRICE_INR}) to continue researching; a completed purchase resets the cycle for free, and this can recur more than once across a membership year. Free users and guests are not subject to this cycle — the only limits that apply to them are the daily guest cap above and the network-level fair-use limit below.
To keep these limits meaningful, usage is also monitored per network address in privacy-preserving hashed form (see the Privacy Policy). Creating multiple accounts, rotating identities, or otherwise circumventing usage limits is prohibited; limits may be enforced at the network level, and circumvention may lead to suspension without refund. Network-level limits do not apply to any account that has completed a purchase or an Increase Usage payment.

7. FREE AND PAID PLANS
Free plan: a limited number of picks per day, resetting at 00:00 UTC. Plus plan: unlimited picks, billed yearly through Razorpay, cancellable at any time and effective at the end of the billing period already paid for. See our Cancellation & Refunds page.

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

