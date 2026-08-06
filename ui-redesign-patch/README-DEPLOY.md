# UI redesign — on the lines of searchllm.ai

Built directly against the screenshot you sent. Compiled clean (verified
with a full `next build` against your codebase before packaging this).

## What changed

**Full redesign, as you asked** — the always-visible tab strip
(Research / Saved / Watchlist / Rewards / admin tabs) is gone. In its
place:

- **Minimal top nav**: `SearchLLM.shop` wordmark + `BETA` pill, then
  Pricing / For brands / Admin (admin only shown if you're an admin
  email), a usage pill (`3/8 picks today`, monospace — same idea as
  searchllm.ai's `10/10 searches today`), your points chip, and an
  avatar circle (or a `?` for guests) instead of a Sign in/out row.
- **Manifesto hero + big search bar** as the home screen — rotates
  between two statements ("Picks that can't be bought." / "Picks that
  are honest.") with the load-bearing words colour-picked the same way
  as the reference screenshot, progress dots underneath, "Attach file"
  as its own pill above a large rounded search bar with a dark "Search"
  button — laid out to match the screenshot as closely as inline styles
  allow.
- **Physics-themed process trace** replacing the old circle-and-checkbox
  step list: `BOSONIC / query synthesis`, `FERMIONIC / checking current
  options`, `ANYONIC / weighing trade-offs`, `COSMIC / writing the
  honest verdict` — same four real steps your backend already does, just
  presented in the searchllm.ai visual language (thin progress bars +
  monospace kickers).
- **Account drawer**: clicking the avatar slides in a panel from the
  right with Saved / Watchlist / Rewards as sub-tabs (Watchlist keeps its
  unseen-count badge), sign in/out lives here now too.
- **Admin console**: clicking "Admin" (nav or footer) switches the whole
  view to the old tab-strip UI for Review queue / Products / Queries /
  Performance / Answers / Reports / Advertisers / For brands — kept
  functionally identical, just moved behind that link instead of always
  showing 9 tabs to every visitor.
- **Grid-paper canvas background** + restyled footer (blue link row +
  trust sentence) matching the reference layout.

## What did NOT change

- No backend, API route, or database logic touched — this is `app/page.jsx`,
  `components/ResearchTab.jsx`, and `app/globals.css` only.
- Every other component (`RewardsTab`, `PriceAlerts`, `AdminQueue`,
  `ProductsBrowser`, etc.) is used exactly as before — only *where* they're
  rendered from changed, not their own internals. If you want those
  restyled to match too, that's a natural follow-up, not included here.
- I could see searchllm.ai's structure and copy from a fetch, and matched
  colours/spacing from the screenshot you sent — but I don't have its
  actual font files or exact hex values, so treat the palette as a close
  match, not a pixel-perfect one. If you can get the real values (e.g. via
  browser devtools → Computed styles on the headline and background), I
  can tighten it further.

## Deploy

Replace these 3 files as-is — no new files, no migration, no env vars:

```
app/page.jsx
components/ResearchTab.jsx
app/globals.css
```

If you've made other local edits to any of these three since the zip you
originally sent me, diff before overwriting.

Push / redeploy as normal.

## Worth checking after deploy

- The account drawer and admin console are both new interaction patterns
  (slide-over panel, view-switch) — worth a quick click-through on both
  desktop and a phone width before pointing real traffic at it.
- The manifesto headline's word colours are set individually per word
  (not a CSS gradient), so if you add a third rotating statement later,
  make sure it still has 2–3 "colored" words for the pattern to read
  correctly.
- German (`ENABLE_GERMAN`) is still off, so none of the new nav/hero
  copy has translations — same limitation the rest of the app already has
  while that flag is paused.
