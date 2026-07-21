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

-- Geography: which countries a listing is valid for (ISO-2 codes, e.g.
-- {IN}, {GB}, {US}). Affiliate offers are almost always geo-restricted —
-- a UK Awin merchant priced in GBP is useless (and often non-shipping) to a
-- shopper in India, and vCommission campaigns carry an explicit countries
-- list. NULL/empty means "no restriction known", which we treat as global.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS regions TEXT[];
CREATE INDEX IF NOT EXISTS idx_listings_regions ON listings USING GIN (regions);

-- Makes the keyword-overlap search in findCandidateListings fast enough to
-- run on every query once the listings table holds six figures of products.
CREATE INDEX IF NOT EXISTS idx_listings_keywords ON listings USING GIN (keywords);
CREATE INDEX IF NOT EXISTS idx_listings_status_approved ON listings (status) WHERE status = 'approved';

-- Product presentation fields. An image makes a shopping recommendation
-- concrete rather than abstract, and showing the destination domain lets a
-- shopper see where an affiliate link goes before they click it.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS merchant_domain TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS discount TEXT;

-- Analytics events. Deliberately coarse: we record that something happened,
-- with a rotating identity for counting unique visitors, but never the query
-- text or anything that would build a shopping profile — consistent with the
-- Privacy Policy. Search counts already live in usage_daily; this table adds
-- the things that weren't recorded anywhere: visits, affiliate clicks, and
-- searches that found no relevant partner product.
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,          -- visit | affiliate_click | no_match | limit_reached
  identity TEXT,                     -- guest id or Clerk user id, for unique counts
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  listing_id INTEGER,
  network TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type_day ON events (event_type, day);
CREATE INDEX IF NOT EXISTS idx_events_day ON events (day);
CREATE INDEX IF NOT EXISTS idx_events_identity ON events (identity, day);

-- =========================================================================
-- DIRECT ADVERTISER PROGRAMME
-- Brands that work with us directly rather than through Awin/Impact/
-- vCommission. We issue the tracking links, record the clicks, receive a
-- conversion postback from the advertiser, and bill the commission.
-- =========================================================================

CREATE TABLE IF NOT EXISTS advertisers (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT NOT NULL,
  phone TEXT,
  gst_number TEXT,
  billing_address TEXT,
  -- 'cps' = percent of sale value, 'cpa' = flat fee per conversion
  commission_model TEXT NOT NULL DEFAULT 'cps',
  commission_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  cookie_days INTEGER NOT NULL DEFAULT 30,
  -- Shared secret the advertiser sends with each conversion postback, so a
  -- third party can't fabricate sales (or suppress them) on their behalf.
  postback_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | paused | rejected
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_advertisers_status ON advertisers (status);

-- Products an advertiser wants promoted. These become listings in the normal
-- review queue, so a direct advertiser gets no shortcut past human review.
CREATE TABLE IF NOT EXISTS advertiser_products (
  id SERIAL PRIMARY KEY,
  advertiser_id INTEGER NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  destination_url TEXT NOT NULL,     -- where the shopper should land
  price TEXT,
  category TEXT,
  image_url TEXT,
  description TEXT,
  tracking_id TEXT UNIQUE NOT NULL,  -- public id used in /go/{tracking_id}
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adv_products_advertiser ON advertiser_products (advertiser_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adv_products_tracking ON advertiser_products (tracking_id);

-- One row per outbound click. click_id is what the advertiser echoes back in
-- the conversion postback, which is how a sale gets attributed.
CREATE TABLE IF NOT EXISTS advertiser_clicks (
  click_id TEXT PRIMARY KEY,
  advertiser_id INTEGER NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES advertiser_products(id) ON DELETE SET NULL,
  country TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adv_clicks_advertiser ON advertiser_clicks (advertiser_id, clicked_at);

CREATE TABLE IF NOT EXISTS advertiser_conversions (
  id SERIAL PRIMARY KEY,
  click_id TEXT REFERENCES advertiser_clicks(click_id) ON DELETE SET NULL,
  advertiser_id INTEGER NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  order_id TEXT,
  order_value NUMERIC(12,2),
  currency TEXT DEFAULT 'INR',
  commission NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | paid
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An advertiser must not be able to report the same order twice.
  UNIQUE (advertiser_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_adv_conv_advertiser ON advertiser_conversions (advertiser_id, status);

-- Campaign attribution. Captured first-party from the landing URL so paid
-- traffic can be measured without embedding third-party trackers, which the
-- Privacy Policy rules out.
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referrer_host TEXT;
CREATE INDEX IF NOT EXISTS idx_events_utm ON events (utm_source, day);

-- =========================================================================
-- PUBLISHED ANSWERS (SEO)
-- Every research answer is already stored as an anonymised microsite record.
-- These columns hold a publishable version: a generic topic and slug, the
-- answer body, and a status so nothing goes public without review — the same
-- gate every listing passes through.
-- =========================================================================
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS who_for TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS who_skip TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS alternatives JSONB DEFAULT '[]';
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_microsites_slug ON microsites (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_microsites_status ON microsites (status, published_at DESC);

-- Shopper ratings from the product feed. A far better quality signal than
-- price: a 4.3-star product with 900 ratings is demonstrably good at its job,
-- whatever it costs. Used to break ties when several products match a query.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rating_count INTEGER;

-- Marks listings whose keywords have been rewritten by the AI enricher, so
-- repeated runs move through the backlog instead of reprocessing the newest
-- rows and burning API calls on work already done.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS keywords_enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_listings_needs_keywords
  ON listings (id DESC) WHERE keywords_enriched_at IS NULL;
