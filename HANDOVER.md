# searchllm-shop — handover (session ending 2026-08-11)

Written so a fresh Claude Code session (or a fresh chat with no prior context)
can pick this up without re-deriving it. Repo:
https://github.com/searchLLM-shop/searchllm-shop, live at searchllm.shop,
Vercel project "searchllm-shop-live", production branch `main`.

**Do not confuse this with `C:\searchllm`** — a completely separate product
(SearchLLM.ai, a professional-services search engine, different GitHub
account/Vercel team/domain). If you're starting a session with access to
both directories, verify which one you're actually in before touching code.

## What this is

SearchLLM.shop is an AI shopping *answer engine* — one researched pick with
real reasoning, plus alternatives explicitly not chosen and why. The core
differentiator, and the whole brand promise: the model that writes the
recommendation never sees what the company would earn on it — commission,
network, and profit data are stripped out before anything reaches the model,
and only attached to the answer *after* it has already chosen. See
`lib/listingMatcher.js` and the flow in `app/api/research/route.js`.

Stack: Next.js 15 (App Router), Postgres, Clerk auth, Razorpay for the Plus
subscription, affiliate networks Awin / Impact / vCommission / Amazon
Associates. Full architecture detail is in `README.md` — this file only
covers what changed this session and what to check next.

## What shipped this session (3 commits, confirmed pushed to origin/main)

1. **`97540f6` — Pre-research clarifying questions.** New feature: before a
   text search runs, a cheap Haiku call (`lib/clarify.js`, new
   `app/api/clarify/route.js`) may ask the shopper one quick question (chip
   suggestions + free text, always skippable) — sits *outside* the quota
   gate so asking/skipping never costs a pick. Answers feed both retrieval
   (folded into `intentSource` in `app/api/research/route.js`, so
   `extractIntent()`'s `retrievalTerms`/`contextQuery`/`priceQuery` reflect
   them) and synthesis (a new `clarificationContext` block appended to the
   model's `userContent`). Recorded on the microsite record via a new
   `clarifications JSONB` column (`schema.sql`, `lib/db.js`). Image-attached
   searches skip the step entirely (avoids a second vision call).
   **⚠ Unverified: whether `ALTER TABLE microsites ADD COLUMN IF NOT EXISTS
   clarifications JSONB DEFAULT '[]';` was actually run against the
   production DB.** If not, every search request currently 500s at the
   `insertMicrosite()` call — check this first if anything is reported
   broken. The exact statement is in `schema.sql`, safe to re-run (`IF NOT
   EXISTS`).
2. **`4b97ba9` — Currency-aware clarifying questions.** Budget-related
   clarifying questions now show ₹ for India, $ elsewhere, via the same
   `x-vercel-ip-country`/`cf-ipcommand` + admin `geoOverride` signal
   `app/api/research/route.js` already used.
3. **`14023ed` — Fixed an overstated honesty claim.** The hero manifesto
   (`components/ResearchTab.jsx`) used to claim a sponsored listing is
   "only looked up after the pick is already decided" — not actually what
   the code does (candidates are looked up before the model call, in the
   same request). Reworded to the claim that's actually true: the model
   never sees commission/network/profit data, only product/brand/price,
   attached only after it's already chosen. Also sharpened `/help` (renamed
   its lead section "How we decide", explained the mechanism precisely, and
   contrasted it with retailer-run AI assistants like Flipkart/Bigbasket
   that can only ever recommend themselves) and linked it from the header
   nav + footer as **"How we decide"** — it existed before but was
   unreachable from anywhere on the site.

Local build check (`npm install && npx next build`) passed on all three;
the repo has no `.env.local` checked in (gitignored) — you'll need to
recreate a dummy one for local build checks, or real Vercel env vars for
anything beyond a syntax check. See the "Environment quirks" section below.

## Confirmed facts about current business state (learned this session, not previously known)

- **vCommission, Amazon Associates, and Awin are LIVE and earning
  commission today** — not "built but not joined" as an earlier draft of
  this doc assumed. **Impact is the one network still to onboard.**
- Real revenue is flowing, even if small — this is genuinely no longer a
  pre-revenue company in the strictest sense, though scale is still early.

## The fundraising track (new this session, lives outside the repo)

The user is actively raising and asked for a full investor pitch deck,
built iteratively across several rounds of revision. **The `.pptx` file
itself lives in this session's scratchpad directory, which will not carry
over to a new chat** — the user has the final version
(`SearchLLM_Seed_Pitch_Deck_v4.pptx`, 21 slides) via direct download; if a
future session needs to rebuild or edit it, either ask the user to
re-upload it or reconstruct from the numbers below using the `pptx` skill
(pptxgenjs, palette: teal `0F6E56` / indigo `4F46E5` / amber `B8790F` /
ink `0B1613`, Cambria/Calibri fonts — see the deck for the full visual
system if reconstructing).

**Current headline numbers (land-grab scenario, the one being pitched):**
- **Ask: ₹8.7 Cr (~US$1.0M), 18-month runway.** Bottom-up: Wages ₹1.6 Cr,
  Advertising ₹2.8 Cr (6.4× a smaller ₹44L base), APIs & WhatsApp ₹2.95 Cr,
  Servers ₹0.37 Cr, +13% buffer.
- **Valuation is presented as two honest numbers, not one:**
  Evidence floor (Berkus method, India-adapted ₹1.75 Cr/pillar cap) =
  ₹5.95 Cr pre-money → ~59% dilution at this ask size. Conviction target
  (if an investor underwrites the land-grab revenue trajectory) = ₹22 Cr
  pre-money → ~28% dilution. The 3.7× gap between them is presented
  explicitly as the premium a conviction-priced investor is being asked to
  underwrite — deliberately not smoothed into one flattering number.
- **Growth assumptions**: ₹2.8 Cr ad budget → a *dampened* ~3× reach
  multiplier (not linear — CAC rises with scale), landing at 210,000 MAU,
  36,000 peak daily interactions, 6,300 Plus subscribers, ₹63.3L net
  monthly revenue by month 18 (₹7.6 Cr projected ARR exit velocity —
  explicitly labeled as projected, not booked).
- **WhatsApp cost, re-derived rigorously**: ₹3/web interaction vs.
  ₹5/WhatsApp interaction (1.7×, not the ~2.3× first assumed) — built from
  actual Anthropic token pricing plus the fact that most WhatsApp replies
  are free (Meta's 24-hour service window), so the premium is the
  multi-turn AI cost of a conversational exchange, not the messaging fee.
- **Revenue Engine has 5 streams** (month-18, land-grab): organic affiliate
  commission, **gate-induced commission** (15% of free users who hit the
  50-query/25-click usage gate buy specifically to avoid paying — a real,
  previously-unquantified stream), Plus subscriptions, Brand Partner Perks
  (brands *already* recommended on merit may add an optional exclusive
  discount — recommendation logic is never influenced by this), and
  **Increase Usage fees** (₹249 recharge, the other 35% of gated users who
  pay instead of buying — also previously unquantified). Loyalty voucher
  cost is modeled bottom-up from the real denominations (₹250/500/1000/2000,
  Plus-only redemption) at ≈5.3% of gross commission, not a flat guess.
- **Breakeven**: ~month 20 at land-grab scale (vs. ~month 22–23 for a
  smaller, base-case round) — bigger spend reaches breakeven *sooner*
  because scale compounds Plus attach and Brand Partner fees faster than
  it compounds burn.

**Investor outreach status** (all drafted in chat, none sent by Claude —
sending status is whatever the user did after reviewing):
- **UNLEASH Capital Partners** (Garima Sahai) — call was scheduled for
  2026-08-12. Their fund's mandate is explicitly financial-inclusion/fintech
  (verified via unleashcp.com), which SearchLLM.shop does not fit — this
  was raised directly and honestly in the pre-call email rather than
  avoided.
- **Bessemer Venture Partners** (Nithin Kaimal, Shrey Agarwal,
  `nkaimal@bvp.com` / `sagarwal@bvp.com`) — good thematic fit (verified via
  bvp.com: $350M dedicated second India fund, 62% of investments pre-revenue
  at initial check, published thesis on "Intelligent Search" and India
  consumer commerce). Outreach email drafted, not confirmed sent.
- **Creddinv** (Dia Jain, `diajain@creddinv.in`) — not a thesis-driven VC;
  an investor platform/marketplace connecting startups to a retail/HNI
  investor network across many sectors. Outreach framed accordingly.
- **Agrasar Ventures** (Abhijeet, Amit — domain is just a parked GoDaddy
  page, no public info available) — already in dialogue; they asked for
  revenue/EBITDA the company doesn't have. Reply drafted honestly
  positioning the round as pre-revenue/IP-based, with an explicit note
  that the ask and dilution will look "completely different" once the
  Meta campaign (below) produces real data.

**The Meta ad campaign** the deck's projections depend on: user said it
launches roughly the week of 2026-08-18, with real results expected around
mid-September 2026. **Once that data exists, the deck's numbers are meant
to be replaced with measured ones, not projected ones** — this was stated
explicitly to every investor contacted. If a new session picks this up
after that date, ask whether campaign results are in before touching the
deck's financials again.

## Conventions worth following (unchanged, still accurate)

- **Identity**: Clerk `userId`, guest cookie id (`lib/guestId.js`), or
  `wa:{phone}` for WhatsApp — one pattern everywhere.
- **Design tokens**: CSS custom properties in `app/globals.css`; brand
  accent `#0F6E56`. Redesign elements use their own one-off colors
  (indigo `#4F46E5`, avatar purple `#7C3AED`, amber `#D97706`) deliberately.
- **i18n**: `lib/i18n.js` + `ENABLE_GERMAN` flag, currently off pending
  legal review — German translations exist but `tr()` always resolves
  English. New clarify-feature strings follow the same `t()` pattern.
- **Cron auth**: `CRON_SECRET` bearer for Vercel-triggered calls,
  `ADMIN_EMAILS` + Clerk session for manual admin calls.
- **Build-check before calling anything done**: `npm install --no-audit
  --no-fund && npx next build`. Needs a dummy `.env.local` (gitignored,
  not present by default) — see below.
- **Push without asking**: once work is committed and verified, push to
  `origin/main` as part of finishing the task — this repo has no CI gate,
  `main` is what Vercel deploys. Still stop and confirm before anything
  destructive (force-push, history rewrite, deleting branches) or before
  sending anything externally (emails, form submissions) on the user's
  behalf without them reviewing it first.

## Environment quirks (this machine)

- Node 24 lives at `C:\Program Files\nodejs`, not on default PATH — prefix
  shell commands with it (`export PATH="/c/Program Files/nodejs:$PATH"` in
  Bash, or `$env:Path = 'C:\Program Files\nodejs;' + $env:Path` in
  PowerShell).
- The Browser pane's `preview_start` cannot spawn `npm` directly in this
  environment — start the dev server as a background shell command first,
  then `preview_start` with the URL.
- Clerk does a live handshake to its own domain on page load — a
  placeholder/dummy publishable key breaks the app in-browser entirely
  (not just prerendering). A syntactically-valid-but-fake key
  (`pk_test_` + base64 of a fake domain + `.clerk.accounts.dev$`) gets
  further but still fails the actual handshake. Full browser verification
  needs real Clerk keys.
- `python` scripts (the `pptx` skill's `validate.py`, etc.) need
  `PYTHONUTF8=1` set on this machine or they choke on curly quotes/em-dashes
  in generated content.
- LibreOffice (`soffice`) is installed directly at `C:\Program
  Files\LibreOffice\program\soffice.exe` — the skill's own `soffice.py`
  wrapper assumes a Unix socket shim that doesn't exist on native Windows
  Python, so call the `.exe` directly rather than through the wrapper.
  `pdftoppm` isn't installed; use Python's `fitz` (PyMuPDF, already
  available) to rasterize the resulting PDF instead.

## Known open items / natural next steps

1. **Verify the `clarifications` column migration actually ran in
   production** — see the ⚠ above. This is the single most important thing
   to check first.
2. Impact network still needs onboarding (vCommission/Amazon
   Associates/Awin already live).
3. Watch for the Meta campaign results (~mid-September 2026) and update the
   pitch deck's financials from measured data once available.
4. No brand-partner-perk deals signed yet (the concept — brands already
   recommended on merit optionally offering an exclusive discount — is
   pitch-deck framing of the existing dormant `SHOW_ADVERTISERS` /
   direct-advertiser program in `lib/constants.js`; the code itself hasn't
   been renamed or changed to match this framing yet).
5. Multi-retailer price comparison, verified-buyer trust layer, German
   locale reactivation (pending legal review) — all still just discussed,
   not built, per the original handover.
6. Watchlist target-price input still isn't in the UI (backend supports it).
