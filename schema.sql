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

-- =========================================================================
-- Network click tracking (sub-ID plumbing).
--
-- Every outbound click to an affiliate NETWORK link (vCommission, Awin) now
-- goes through /out/[listingId], which mints a click_id, records it here,
-- and appends it to the tracked link as the network's sub-ID parameter
-- (Awin: clickref; vCommission/Trackier: p1 — VERIFY against a live
-- conversion report before relying on it). The network echoes the sub-ID
-- back in its transaction reports, which is what makes per-click conversion
-- attribution possible — the foundation for the loyalty programme.
--
-- Privacy: identity here is the same rotating user/guest identity already
-- stored with affiliate_click events. The network never receives it — only
-- the opaque click_id crosses the wire. The conversion columns stay empty
-- until a future polling cron fills them; joining CONVERSIONS back to a
-- user identity is loyalty-programme territory and must not ship before
-- the programme's opt-in consent and the Privacy Policy amendment.
-- =========================================================================
CREATE TABLE IF NOT EXISTS network_clicks (
  id SERIAL PRIMARY KEY,
  click_id TEXT NOT NULL UNIQUE,
  listing_id INTEGER REFERENCES listings(id),
  network TEXT,
  identity TEXT,                     -- clerk user id or guest id
  context TEXT,                      -- 'research' | 'answer'
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Conversion matching, filled by the (future) transaction-polling cron.
  conversion_status TEXT,            -- pending | approved | declined
  order_value NUMERIC(12,2),
  commission NUMERIC(12,2),
  currency TEXT,
  network_transaction_id TEXT,       -- the network's own id, for dedupe
  matched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_network_clicks_identity ON network_clicks (identity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_clicks_listing ON network_clicks (listing_id);
-- One row per network transaction: the poller upserts on this, so a re-run
-- can never credit the same sale twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_clicks_txn
  ON network_clicks (network, network_transaction_id)
  WHERE network_transaction_id IS NOT NULL;

-- =========================================================================
-- Full-text search over listings (zero-cost matching).
--
-- Candidate matching previously depended entirely on the keywords array,
-- which for feed products is derived mechanically from the title and for a
-- while was "improved" by AI enrichment — an unattended per-product model
-- spend that descriptive product titles never needed. This generated
-- tsvector matches directly against title + brand + category with English
-- stemming ("powders" finds "powder"), so un-enriched listings match well
-- and the AI enricher becomes a manual, deliberate tool for the few
-- affiliate-jargon campaign titles that genuinely need it.
-- NOTE: adding a STORED generated column rewrites the table — on ~200K+
-- rows expect the ALTER to take a little while. Run it once, off-peak.
-- =========================================================================
-- Weighted: title+brand rank highest (A), category next (B), and the
-- product description/pitch lowest (C) — a query word appearing only in a
-- description is a real but weak signal ("compatible with TV" in a cable's
-- blurb must never outrank an actual TV), and ts_rank respects the weights.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(product, '') || ' ' || coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(pitch, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_listings_search_tsv ON listings USING GIN (search_tsv);

-- =========================================================================
-- Anonymous search-query log (demand signal for inventory).
--
-- Records WHAT is being searched — deliberately never WHO searched it.
-- There is no identity column by design: the live privacy posture promises
-- no per-user shopping history, and this table must never quietly become
-- one. What it gives us is the aggregate demand signal: the top unmatched
-- queries are precisely the feeds to request from the networks next.
-- Content-filtered (prohibited) queries are never recorded at all.
-- =========================================================================
CREATE TABLE IF NOT EXISTS search_queries (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  matched BOOLEAN NOT NULL DEFAULT false,
  listing_id INTEGER,
  network TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_created ON search_queries (created_at DESC);

-- =========================================================================
-- Loyalty programme (opt-in).
--
-- Members earn points on purchases made through our tracked links, computed
-- from the commission the network CONFIRMS — never a flat per-order amount,
-- so the programme mathematically cannot pay out more than it earns. The
-- ledger mirrors the network conversion lifecycle exactly: pending inside
-- the return window, confirmed when the commission is approved, reversed on
-- decline. Only clicks made AFTER the member consented ever accrue — the
-- consent boundary is enforced in the earning query itself, not by policy.
-- =========================================================================
CREATE TABLE IF NOT EXISTS loyalty_members (
  user_id TEXT PRIMARY KEY,               -- Clerk user id; accounts only, never guests
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  click_id TEXT UNIQUE,                   -- one entry per converted click; re-polls update in place
  points NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL,                   -- pending | confirmed | reversed
  commission NUMERIC(12,2),
  currency TEXT,
  network TEXT,
  listing_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user ON points_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS redemptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  voucher_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | fulfilled | rejected
  voucher_code TEXT,                        -- filled by admin on manual fulfilment
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions (user_id, created_at DESC);

-- Loyalty v2 additions: points now come from two sources — 'purchase'
-- (commission-derived, self-funding) and 'search' (engagement credit,
-- capped in code). Guest day-points are never stored: they're computed
-- live from usage_daily and expire by simply being recomputed tomorrow.
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'purchase';
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS note TEXT;

-- WhatsApp channel: webhook message dedupe. Meta retries webhooks it
-- believes unacknowledged; without this, a slow research call would produce
-- duplicate replies to the same question.
CREATE TABLE IF NOT EXISTS wa_processed (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lifecycle checkpoints: the engagement-without-conversion gates.
-- kind 'search': blocking — every 50 lifetime picks without a purchase, a
--   feedback form (or a ₹249 recharge) unlocks the next 50.
-- kind 'click': informational — every 25 affiliate clicks without a
--   conversion, a "you've clicked N links but not purchased" prompt with a
--   feedback form. Never blocks clicks: clicks are the revenue action.
-- One row per (user, kind, block); status 'feedback' or 'paid' records how
-- it was resolved. The feedback text is the real prize — engaged non-buyers
-- telling us exactly why they don't buy.
CREATE TABLE IF NOT EXISTS user_checkpoints (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  status TEXT NOT NULL,               -- feedback | paid
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, block_number)
);

-- IP-level fair-use tracking (hashed — raw IPs are never stored). Catches
-- multi-account evasion of the usage gates: limits are enforced per network
-- address as well as per account, with anyone who has ever paid or
-- purchased exempt (shared/carrier IPs must never punish paying users).
CREATE TABLE IF NOT EXISTS ip_activity (
  ip_hash TEXT NOT NULL,
  day DATE NOT NULL,
  searches INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

-- Alternative-product clicks: the demand-measurement instrument. The
-- alternatives in an answer carry NO affiliate relationship (that's the
-- trust architecture) — they link to a neutral web search — but each click
-- is recorded here as evidence for brand conversations: "your product
-- pulled N clicks on our platform" is how the catalog grows.
CREATE TABLE IF NOT EXISTS alt_clicks (
  id SERIAL PRIMARY KEY,
  brand TEXT,
  product TEXT NOT NULL,
  identity TEXT,
  context TEXT,                -- research | answer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Plain timestamp index: an expression index on created_at::date is
-- invalid (the cast is timezone-dependent, not IMMUTABLE) — learned in
-- production 2026-07-24.
CREATE INDEX IF NOT EXISTS idx_alt_clicks_created ON alt_clicks (created_at);

-- Publication gate (2026-07-29). Corpus membership and INDEX membership are
-- different things: every answer feeds the engine, only a qualifying
-- minority earns a URL Google is allowed to see. gate_result is written for
-- every draft including failures, so thresholds can be tuned against real
-- decisions instead of guessed at.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS search_performed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS gate_result JSONB;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_microsites_hash ON microsites (content_hash);

-- Pre-research clarifying questions (2026-08-08). Records what lib/clarify.js
-- asked and what the shopper answered, if anything — [] when the step was
-- skipped or the model judged the query already complete. Kept alongside the
-- answer for the same reason gate_result is: so the questions/answers that
-- actually shaped a pick can be reviewed later, not just trusted blind.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS clarifications JSONB DEFAULT '[]';

-- Cosmic-layer popularity gate (2026-08-19). The synthesis model's own
-- calibrated judgment of demand for this product/category — 'high' |
-- 'medium' | 'low' | 'niche' | NULL. NULL means either the model didn't
-- return a valid value, or the row predates this column: lib/publicationGate.js
-- treats NULL as "unknown, don't block" on purpose, so this can never
-- retroactively fail an already-in-flight draft.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS popularity_level TEXT;

-- =========================================================================
-- Price-drop watchlist (originally shipped 2026-08-06 as a standalone
-- "price-alerts-patch" bundle rather than edits to this file — lib/priceAlerts.js,
-- app/api/watchlist/route.js and app/api/admin/pricecheck/route.js all made
-- it into the real codebase, but this migration was left inside that patch
-- folder and never folded in here. Found and fixed 2026-08-20 during a
-- pre-migration schema audit: every table/column referenced anywhere in
-- lib/db.js, lib/priceAlerts.js and app/api/whatsapp/webhook/route.js (the
-- only three files touching raw SQL in this codebase) was cross-checked
-- against this file — this was the only gap. If you're reading this while
-- setting up a fresh database, this IS load-bearing: without it, the
-- watchlist feature and price-drop cron fail outright with "relation does
-- not exist", not a silent degrade.
--
-- Design: this deliberately does NOT add a new price-fetching job. The
-- hourly Awin/Impact/vCommission sync (app/api/admin/sync, already
-- scheduled in vercel.json) already refreshes listings.price on every run
-- — that's the real-world price feed. This feature only watches for drops
-- in numbers that are already being kept fresh, on a cron that runs
-- shortly after sync. Manually-entered listings (source='manual') won't
-- see automatic price drops since nothing refreshes their price; that's
-- expected, not a bug.
-- =========================================================================

-- One row per (identity, listing) a shopper is tracking. identity is the
-- same value used everywhere else in the app: a Clerk user id, a guest
-- cookie id, or "wa:{phone}" for the WhatsApp channel.
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
