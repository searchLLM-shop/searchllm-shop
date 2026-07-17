-- schema.sql
-- Run this once against your Postgres database before first deploy:
--   psql $DATABASE_URL -f schema.sql
-- or paste into your hosting provider's SQL console (Vercel Postgres,
-- Supabase, Neon all have one in their dashboard).

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  price TEXT,
  category TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  network TEXT NOT NULL,           -- 'Awin' | 'Impact' | 'vCommission'
  network_link TEXT NOT NULL,
  pitch TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  -- Phase: feed ingestion. source distinguishes a manually typed-in
  -- submission from one pulled automatically from a network's product
  -- feed. external_id is that network's own product/SKU identifier —
  -- used to detect "this is the same product on a re-sync" so the sync
  -- job updates the existing row (price, availability) instead of
  -- creating a duplicate pending listing every time it runs.
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'feed'
  external_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A given network + external product ID should only ever correspond to
-- one row, regardless of how many times the sync job runs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_network_external_id
  ON listings (network, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings (source);

-- Phase: feed ingestion. One row per sync attempt, so the admin UI can
-- show "Awin: last synced 2 hours ago, 340 products, 12 new" rather than
-- syncing being an invisible background process with no audit trail.
CREATE TABLE IF NOT EXISTS feed_sync_runs (
  id SERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  status TEXT NOT NULL,            -- 'success' | 'error'
  products_seen INTEGER DEFAULT 0,
  new_listings INTEGER DEFAULT 0,
  updated_listings INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS microsites (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  task_type TEXT,                  -- research | creative | technical | predictive | analysis
  learnings JSONB DEFAULT '[]',
  listing_id INTEGER REFERENCES listings(id),
  query_hash TEXT,                 -- anonymized hash, never the raw query text
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_microsites_task_type ON microsites (task_type);

-- Phase 3: real per-user daily quota tracking, replacing the in-memory
-- placeholder counter from app/api/research/route.js in Phase 2.
-- One row per (identity, day). identity is either a Clerk user ID
-- ("user_xxx") or a guest session ID stored in a cookie ("guest_xxx").
CREATE TABLE IF NOT EXISTS usage_daily (
  identity TEXT NOT NULL,
  day DATE NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, day)
);

-- Phase 3: tracks each user's plan tier, updated by the Razorpay webhook
-- on subscription activation/cancellation. Keyed by Clerk user ID.
-- (Originally built on Stripe; switched to Razorpay because Stripe is
-- invite-only for new Indian businesses. If you already ran the old
-- schema with stripe_* columns, run:
--   ALTER TABLE user_plans DROP COLUMN IF EXISTS stripe_customer_id;
--   ALTER TABLE user_plans DROP COLUMN IF EXISTS stripe_subscription_id;
--   ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS subscription_id TEXT; )
CREATE TABLE IF NOT EXISTS user_plans (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',          -- 'free' | 'plus'
  subscription_id TEXT,                       -- Razorpay subscription ID
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Seed data matching the original prototype, so the app isn't empty on
-- first run. IMPORTANT: all three seeds start as 'pending', not
-- 'approved' — their network_link values are placeholders (containing
-- "YOUR_ID" or "...") and must not go live as real, clickable affiliate
-- links before you've replaced them with real tracking links and
-- reviewed them in the admin queue. An earlier draft of this file marked
-- two of these 'approved' directly, which would have put broken
-- placeholder links in front of real users immediately on first deploy —
-- caught and fixed before this was meant to run against a real database.
INSERT INTO listings (brand, product, price, category, keywords, network, network_link, pitch, status)
VALUES
  ('Trailhead Gear Co.', 'WeatherShell 2.0 hiking jacket', '$189', 'outdoor',
   ARRAY['hiking','jacket','rain','waterproof','outdoor','trail','coat'],
   'Awin', 'https://www.awin1.com/cread.php?awinmid=0000&awinaffid=YOUR_ID&clickref=weathershell-2',
   'Fully seam-taped 3-layer shell, 20k/20k waterproof rating, packs to the size of a water bottle.',
   'pending'),
  ('Northbeam Audio', 'Northbeam Pro wireless headphones', '$129', 'electronics',
   ARRAY['headphones','audio','wireless','earbuds','music','noise cancelling'],
   'Impact', 'https://goto.impact.com/...northbeam-pro',
   '32-hour battery, active noise cancelling, the most-returned competitor at this price is usually the loudness, not these.',
   'pending'),
  ('Wildcraft', 'Wildcraft Trailblazer 40L rucksack', '₹4,499', 'outdoor',
   ARRAY['backpack','rucksack','hiking','trek','travel','bag'],
   'vCommission', 'https://vcommission.com/aff_c?offer_id=0000&aff_id=YOUR_ID',
   'Rain cover built in, COD available, the most common complaint with imported packs is no COD option.',
   'pending')
ON CONFLICT DO NOTHING;

-- Persistent cursor so the Awin sync downloads exactly ONE advertiser feed
-- per run and advances to the next on the following run. Prevents the
-- multi-download memory spike that was killing the function.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
