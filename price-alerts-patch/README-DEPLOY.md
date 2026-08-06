# Price-drop watchlist — deploy guide

Adds: a "🔔 Watch price" button on any sponsored pick, a Watchlist tab with
a drop-count badge, an hourly cron that piggybacks on your existing Awin/
Impact/vCommission price sync to detect real drops (3%+, or a shopper's own
target price), and WhatsApp notifications for anyone who reached you via
the WhatsApp channel. Web/guest users see drops next time they open the
app (badge on the Watchlist tab); nothing new to configure for them.

No new price-fetching job was added — it reuses `listings.price`, which
your hourly `/api/admin/sync` cron already refreshes. Watches on manually
entered (non-feed) listings won't auto-detect drops, since nothing
refreshes their price — expected, not a bug.

## 1. Run the migration

One new file, additive only (new tables, nothing touched on existing ones):

```
psql $DATABASE_URL -f migrations/2026-08-06_price_alerts.sql
```

Or paste `migrations/2026-08-06_price_alerts.sql` into your Vercel
Postgres / Supabase / Neon SQL console, same as you did for `schema.sql`.

## 2. Copy in the new files

Drop these into your repo at the same paths (no existing files touched):

```
lib/priceAlerts.js
app/api/watchlist/route.js
app/api/admin/pricecheck/route.js
components/PriceAlerts.jsx
```

## 3. Replace these 3 files

These are full modified versions of files you already have — replace them
as-is:

```
vercel.json                    → adds the pricecheck cron entry
app/page.jsx                   → adds the Watchlist tab + unseen badge
components/ResearchTab.jsx     → adds the "Watch price" button
```

If you've made other local edits to `page.jsx` or `ResearchTab.jsx` since
the zip you sent me, diff before overwriting — I built these against
exactly what was in `searchllm-ALL-changes__45_.zip`.

## 4. Environment variables

Nothing new required. The cron reuses `CRON_SECRET` (already set, since
`/api/admin/sync` and `/api/admin/enrich-keywords` depend on it) and
`ADMIN_EMAILS` for the manual "check now" path. WhatsApp notifications
reuse your existing `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` —
if those aren't set, WhatsApp sends just no-op (same fallback pattern as
`whatsappConfigured()` elsewhere in the app).

## 5. Deploy

Push / redeploy as normal. Vercel picks up the new cron entry
(`/api/admin/pricecheck` at `:15` past every hour, 15 minutes after your
existing hourly sync at `:00`) from `vercel.json` automatically — no
dashboard step needed.

## 6. Verify

- Run a research query that surfaces a sponsored match, click
  "🔔 Watch price" — it should flip to "🔔 Watching".
- Open the **Watchlist** tab — the item should be listed with its price at
  the time you watched it.
- To test end-to-end without waiting an hour: as an admin, `POST` to
  `/api/admin/pricecheck` (session-authenticated, same as other admin
  routes) to run the check immediately. Manually lower a test listing's
  `price` in the DB first if you want to see a real alert fire.

## What I did NOT touch

- No changes to `schema.sql`, `db.js` internals, the research route, or
  the WhatsApp webhook's inbound-message handling — this only adds a new
  outbound notification path for `wa:` identities.
- Didn't wire a "remove watch" affordance into the sponsored-match card
  itself — that lives only in the Watchlist tab for now, to keep the
  research card uncluttered. Easy to add if you want it there too.
- Target-price input (shopper picks their own "tell me at ₹X") isn't
  exposed in the UI yet — the API (`POST /api/watchlist` with
  `targetPrice`) and the drop logic already support it; it's a small
  follow-up if you want it.
