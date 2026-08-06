-- migrations/2026-08-06_price_alerts.sql
--
-- Price-drop watchlist. Run this once against the production database
-- before deploying the code that uses it:
--   psql $DATABASE_URL -f migrations/2026-08-06_price_alerts.sql
-- or paste into Vercel Postgres / Supabase / Neon's SQL console — same as
-- schema.sql was run.
--
-- Design: this deliberately does NOT add a new price-fetching job. The
-- hourly Awin/Impact/vCommission sync (app/api/admin/sync, already
-- scheduled in vercel.json) already refreshes listings.price on every run
-- — that's the real-world price feed. This feature only watches for drops
-- in numbers that are already being kept fresh, on a cron that runs
-- shortly after sync. Manually-entered listings (source='manual') won't
-- see automatic price drops since nothing refreshes their price; that's
-- expected, not a bug.

-- One row per (identity, listing) a shopper is tracking. identity is the
-- same value used everywhere else in the app: a Clerk user id, a guest
-- cookie id, or "wa:{phone}" for the WhatsApp channel — see
-- lib/db.js / getLifecycleStatus and app/api/whatsapp/webhook for the
-- existing identity convention this reuses rather than inventing a new one.
CREATE TABLE IF NOT EXISTS price_watches (
  id SERIAL PRIMARY KEY,
  identity TEXT NOT NULL,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  baseline_price NUMERIC(12,2),        -- numeric price at the moment the watch was created
  baseline_price_text TEXT,            -- raw display string at watch time (for the UI)
  target_price NUMERIC(12,2),          -- optional: shopper's own "tell me at ₹X or below"
  last_checked_price NUMERIC(12,2),    -- most recent price seen by the cron
  last_notified_price NUMERIC(12,2),   -- price at the last alert sent, so we never re-notify the same price
  last_notified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identity, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_price_watches_listing ON price_watches (listing_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_price_watches_identity ON price_watches (identity) WHERE active;

-- Append-only price snapshots — bounded to listings someone is actually
-- watching (not every listing on every sync), so this stays small.
CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price NUMERIC(12,2),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history (listing_id, checked_at DESC);

-- One row per notification actually sent (or shown in-app), so the Alerts
-- panel has something durable to render and a re-run of the cron can't
-- double-notify for the same drop.
CREATE TABLE IF NOT EXISTS price_alerts (
  id SERIAL PRIMARY KEY,
  watch_id INTEGER NOT NULL REFERENCES price_watches(id) ON DELETE CASCADE,
  identity TEXT NOT NULL,
  listing_id INTEGER NOT NULL,
  old_price NUMERIC(12,2),
  new_price NUMERIC(12,2),
  channel TEXT NOT NULL DEFAULT 'inapp',   -- 'whatsapp' | 'inapp'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_price_alerts_identity ON price_alerts (identity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_unseen ON price_alerts (identity) WHERE seen_at IS NULL;
