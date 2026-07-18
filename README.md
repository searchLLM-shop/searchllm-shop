# SearchLLM.shop — LIVE

Deployed and working at searchllm-shop-live.vercel.app (custom domain
searchllm.shop connects via GoDaddy DNS per the deployment section below).

## Current status (as of this build)

WORKING END TO END:
- Live site with consent gate, honest AI recommendations, real alternatives
- Clerk auth, per-user daily quota, Razorpay Plus subscription + webhook
- Postgres database (Prisma Postgres on Vercel), all tables live
- Admin review queue with bulk approve, source badges, placeholder-link warnings
- Product feed sync: memory-safe, one advertiser feed per run via a
  persistent cursor, 12MB download cap, batch DB insert, non-blocking UI
- Impact site verification, Awin/Impact/vCommission adapters

THE ONE REMAINING ACTION (not code — a dashboard task):
- You must JOIN Awin advertiser programmes. A diagnostic confirmed all 607
  feeds in the account currently show "Not Joined", which is why sync pulls
  0 products. This is expected — you have to apply to and be approved for
  advertiser programmes in the Awin dashboard (Advertisers -> Join
  Programme). Once even one shows "Joined", hit "Sync now" and its products
  flow into the review queue with real, revenue-earning tracking links.
- The 210 products currently in the database came from a manually-uploaded
  sample feed during testing; they are real products but not from a joined
  programme, so treat them as test data until you're joined for real.

---

# SearchLLM.shop — real Next.js codebase

Phase 2 (working codebase), Phase 3 (real auth/payments/database), and
Phase 4 (domain connection) are all reflected here. What's left after this
is Phase 5: the pre-launch testing pass, covered in
`SearchLLM_Architecture_Deployment_UserGuide.docx`, Section 5.3.

## Brave Search — now wired in, with search-or-skip logic

Rather than calling Brave on every query (added latency and cost for
questions that don't need it), `lib/braveSearch.js` mirrors the original
bosonic layer's "search-or-skip" decision: a lightweight pattern check
(`shouldSearch`) looks for time-sensitivity signals — "current", "latest",
"newest", a specific year, "in stock", "on sale" — and only calls Brave
when one matches. Most shopping questions ("what jacket should I get for
hiking") skip the search entirely and answer from the model's own
knowledge plus the matched listing, exactly as before.

When a search does fire, results are summarized into a short context block
appended to the prompt — not dumped wholesale — and the response includes
a `searchUsed` flag so the UI can show a "checked current web results"
badge as a trust signal. If Brave's API fails or the key isn't set, the
search step degrades silently to "answer without live search" rather than
breaking the whole research flow — see the try/catch in `braveSearch()`.

Get a Brave Search API key from api.search.brave.com and set
`BRAVE_API_KEY` in your environment before this does anything — without
it, every query just answers from the model's own knowledge, which is
also a perfectly fine mode to run in if you decide search isn't worth the
added cost later.

## Automatic product feed ingestion — replaces manual-only submission

Brands no longer have to be typed in one at a time. `lib/feeds/` pulls
real product data directly from each network's own feed/catalog API on a
schedule, normalizes it into one common shape, and writes it into the
exact same `listings` table — as `pending`, going through the exact same
human review queue as a manually submitted listing. Nothing about the
honesty guarantee or the review gate changes; feed-sourced listings don't
get a shortcut to "approved."

**Awin**: uses the documented product feed API
(`productdata.awin.com/datafeed/list/apikey/...`), in the Google Shopping
product spec format. Fully implemented in `lib/feeds/awin.js`.

**Impact**: uses Impact's real REST API — list catalogs you have access
to, then page through each catalog's items. The most capable of the
three networks for this, since it supports live querying, not just bulk
file downloads. Fully implemented in `lib/feeds/impact.js`.

**vCommission — honestly incomplete.** As of this writing, vCommission
has no publicly documented product/offer feed API. An API key exists in
the publisher dashboard (Tools → API), but what it actually returns isn't
documented anywhere public, and existing publishers report needing to
contact their account manager directly for feed access and format.
`lib/feeds/vcommission.js` is a deliberate stub: it defines the exact
contract the function must fulfill (same normalized shape as the other
two adapters) with detailed comments on what to ask vCommission's support
team for, so filling it in later is a contained, well-scoped task rather
than a rebuild. Until then, vCommission listings still go through the
manual "For brands" form.

### How the sync runs

- **Automatic**: every 6 hours via Vercel Cron (see `vercel.json`).
  Vercel sends a real `Authorization: Bearer <CRON_SECRET>` header on
  these requests — set `CRON_SECRET` in your environment
  (`openssl rand -hex 32` to generate one).
- **Manual**: a "Sync now" button in the admin Review queue tab, which
  also shows the last sync result per network (products seen, new
  listings, updated listings, or an error message if one failed).
- **Deduplication**: each product is keyed by `(network, external_id)` —
  re-syncing the same product updates its price/details in place rather
  than creating a duplicate pending listing every 6 hours. An
  already-approved listing stays approved when it refreshes; it doesn't
  get bumped back into the review queue just because its price changed.

### Setup

In addition to the variables already documented above, set:
`AWIN_DATAFEED_API_KEY`, `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN`,
`VCOMMISSION_API_KEY` (once you have one to use), and `CRON_SECRET`. Run
the updated `schema.sql` against your database — it now includes
`source`, `external_id`, and `last_synced_at` columns on `listings`, plus
a new `feed_sync_runs` table.

## What changed from the prototype (Phase 2)

- **The Anthropic API call now runs on the server** (`app/api/research/route.js`),
  never in the browser. The API key lives only in environment variables.
- **Listings live in Postgres** (`schema.sql`), not in a React `useState`
  array. Brand submissions write to the database; the admin queue reads
  and updates it for real.
- **The honesty guarantee is structural in the backend**:
  `lib/listingMatcher.js` strips a matched listing down to
  product/brand/price *before* it's allowed anywhere near the Anthropic
  API call. Commission and network data never enter that request.

## What Phase 3 added — real quota, real billing, real auth

- **Per-user daily quota is now real**, backed by a `usage_daily` table
  (see `schema.sql`). Signed-in users are tracked by their Clerk user ID;
  guests get a stable, httpOnly cookie ID (`lib/guestId.js`) so the count
  is per-visitor, not global. The counter genuinely resets at 00:00 UTC,
  matching the product copy's promise.
- **Razorpay billing is wired end to end**:
  - `app/api/checkout/route.js` creates a Checkout session for the Plus plan.
  - `app/api/razorpay/webhook/route.js` is the *only* place a user's plan
    actually changes to "plus" — it verifies Razorpay's HMAC signature before
    trusting the event, so a user can't fake an upgrade by hitting the
    success URL directly.
  - `lib/db.js` has `getUserPlan` / `upsertUserPlan` for the `user_plans`
    table, which the research route now reads on every request to decide
    the real quota limit.
- **The UI reflects real state**: the header shows the actual plan (Free
  or Plus) and the actual remaining picks for today, fetched from
  `/api/usage` — not a number that resets when you refresh the page.

### Razorpay setup steps (do this in the Razorpay dashboard, not in code)

Stripe is invite-only for new Indian businesses, so payments run on
Razorpay (INR-native, supports UPI/netbanking/cards).

1. Create an account at dashboard.razorpay.com and complete KYC.
2. Settings -> API Keys -> generate a key pair; put them in
   `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (test keys first).
3. Subscriptions -> Plans -> create a monthly plan for the Plus tier
   (e.g. Rs.500/month); copy its `plan_...` ID into `RAZORPAY_PLAN_ID`.
4. Settings -> Webhooks -> add `https://searchllm.shop/api/razorpay/webhook`
   subscribed to `subscription.activated`, `subscription.charged`,
   `subscription.cancelled`, `subscription.halted`,
   `subscription.completed`; the secret you set goes in
   `RAZORPAY_WEBHOOK_SECRET`.
5. Test in Test Mode end to end (Razorpay provides test UPI/card flows)
   before switching to live keys.

## What Phase 4 added — domain connection

`vercel.json` pins the build configuration. The actual domain connection
is done in two dashboards, not in code:

1. **Deploy to Vercel first**: `vercel deploy --prod` (or connect the repo
   in the Vercel dashboard for automatic deploys on push). Set every
   variable from `.env.example` in Vercel → Project Settings →
   Environment Variables before the first deploy — the build will fail
   without `DATABASE_URL` and the Clerk keys present.
2. **Add the domain in Vercel**: Project → Settings → Domains → add
   `searchllm.shop`. Vercel will show you the exact DNS records to add.
3. **Add those records in GoDaddy**: GoDaddy account → My Products →
   DNS → search llm.shop → add the records Vercel showed you. Typically:
   - An `A` record for the root domain pointing at Vercel's IP (Vercel
     shows the current correct IP — don't hardcode an old one from
     documentation, it can change).
   - A `CNAME` record for `www` pointing at `cname.vercel-dns.com`.
4. **Wait for propagation** (usually minutes, can take up to 48 hours) and
   confirm in Vercel's dashboard that the domain shows as verified with a
   valid SSL certificate issued automatically.
5. **Update Razorpay webhook URL and Clerk redirect URLs** to use the real domain
   instead of a Vercel preview URL, once the domain is live.

## Setup (local development)

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in real values.
3. Run the schema against your database once:
   `psql $DATABASE_URL -f schema.sql`
4. `npm run dev` and open `localhost:3000`

## What's still NOT done — be aware before calling this fully launched

- **The "we also considered" alternatives are still a static, hardcoded
  pool** (`lib/constants.js`), matched by a simple keyword regex. Fine at
  five seed listings, will need to become real/queryable as listing
  volume grows.
- **Phase 5 (pre-launch testing) hasn't been run yet.** See the checklist
  in `SearchLLM_Architecture_Deployment_UserGuide.docx`, Section 5.3,
  before sending real traffic or approving real brand listings.

