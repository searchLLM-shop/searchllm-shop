"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton, SignOutButton } from "@clerk/nextjs";
import ConsentGate from "@/components/ConsentGate";
import ResearchTab from "@/components/ResearchTab";
import BrandForm from "@/components/BrandForm";
import AdminQueue from "@/components/AdminQueue";
import ReportsPanel from "@/components/ReportsPanel";
import { PLANS, LOYALTY, SHOW_ADVERTISERS, SHOW_BRANDS_FORM, ENABLE_GERMAN } from "@/lib/constants";
import { LOCALES, DEFAULT_LOCALE, resolveLocale, t } from "@/lib/i18n";
import AdvertiserPanel from "@/components/AdvertiserPanel";
import AdvertiserAdmin from "@/components/AdvertiserAdmin";
import AnswersAdmin from "@/components/AnswersAdmin";
import ProductsBrowser from "@/components/ProductsBrowser";
import QueriesPanel from "@/components/QueriesPanel";
import PerformancePanel from "@/components/PerformancePanel";
import RewardsTab from "@/components/RewardsTab";
import PriceAlerts from "@/components/PriceAlerts";
import InstallApp from "@/components/InstallApp";
import { trackEvent } from "@/lib/track";

// Bump this whenever the Privacy Policy or Terms of Use changes materially
// — it invalidates stored consent and forces the gate to show again, which
// is what the Privacy Policy promises ("30 days' notice before any
// material change") in spirit, applied to first-party UX.
const CONSENT_VERSION = "2026-09-shop-v2";

// Tells the client whether to show the admin tab. This is a soft check for
// UI purposes only — the real enforcement happens server-side in every
// /api/admin/* route via isAdminUser (lib/isAdmin.js), which re-checks
// independently. Never trust this flag alone to gate sensitive actions.
// Checks phone as well as email (2026-09-02: sign-up is moving to
// phone-only, so an admin account may have no email at all) — mirrors
// isAdminUser's logic client-side against the NEXT_PUBLIC_ variants of the
// same allowlists, since server-only env vars aren't visible here.
function useIsAdminClientHint() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const phone = user?.primaryPhoneNumber?.phoneNumber;
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
  const adminPhones = (process.env.NEXT_PUBLIC_ADMIN_PHONES || "")
    .split(",")
    .map((p) => last10(p));
  return Boolean(
    (email && adminEmails.includes(email.toLowerCase())) ||
    (phone && adminPhones.includes(last10(phone)))
  );
}

export default function Home() {
  const [consented, setConsented] = useState(null); // null = not yet checked
  const [activeTab, setActiveTab] = useState("admin"); // admin console's internal tab only, post-redesign
  const [savedPicks, setSavedPicks] = useState([]);
  const [expandedPick, setExpandedPick] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);

  // Saved picks previously lived only in React state, so they vanished on
  // refresh. Persist them locally instead — they're personal notes, and
  // keeping them on the device avoids storing shopping history server-side,
  // which is consistent with what the privacy policy promises.
  // Record one visit per browser session so unique-visitor counts mean
  // something. Fire-and-forget: analytics must never delay or break the page.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("sllm_visit_logged")) return;
      sessionStorage.setItem("sllm_visit_logged", "1");
      // Read campaign parameters from the landing URL and the referring
      // domain. This is first-party attribution: nothing is sent to Google or
      // Meta, and no cross-site identifier is set — which keeps the promise
      // in the Privacy Policy while still showing which campaigns work.
      const params = new URLSearchParams(window.location.search);
      let referrerHost = null;
      try {
        if (document.referrer) {
          const r = new URL(document.referrer);
          if (r.hostname !== window.location.hostname) referrerHost = r.hostname.replace(/^www\./, "");
        }
      } catch { /* malformed referrer */ }

      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "visit",
          utm: {
            source: params.get("utm_source"),
            medium: params.get("utm_medium"),
            campaign: params.get("utm_campaign"),
            referrerHost,
          },
        }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* storage unavailable — skip rather than fail */ }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("sllm_saved_picks");
      if (raw) setSavedPicks(JSON.parse(raw));
    } catch { /* corrupt or unavailable storage — start empty */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sllm_saved_picks", JSON.stringify(savedPicks));
    } catch { /* quota exceeded or private mode — saving is best-effort */ }
  }, [savedPicks]);

  function normaliseQuery(q) {
    return (q || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function handleSavePick(pick) {
    const key = normaliseQuery(pick.query);
    const already = savedPicks.some((p) => normaliseQuery(p.query) === key);
    if (already) {
      setSaveNotice(tr("alreadySaved"));
      setTimeout(() => setSaveNotice(null), 3000);
      return;
    }
    if (savedLimit !== -1 && savedPicks.length >= savedLimit) {
      setSaveNotice(`You've saved ${savedLimit} picks — remove one to save another.`);
      setTimeout(() => setSaveNotice(null), 5000);
      return;
    }
    setSavedPicks((p) => [{ ...pick, savedAt: Date.now() }, ...p]);
    setSaveNotice(tr("savedOk"));
    setTimeout(() => setSaveNotice(null), 2500);
  }

  function removePick(id) {
    setSavedPicks((p) => p.filter((x) => x.id !== id));
    setExpandedPick((cur) => (cur === id ? null : cur));
  }
  const [usage, setUsage] = useState(null); // { limit, used, points }
  const [watchlistUnseen, setWatchlistUnseen] = useState(0);
  // Redesign: shopper-facing tabs (Saved/Watchlist/Rewards) now live behind
  // an account drawer opened from the avatar, and admin tooling lives
  // behind its own console opened from the "Admin" nav link — mirrors
  // searchllm.ai's minimal-chrome landing instead of an always-visible
  // tab strip. `activeTab` is kept as the name for the admin console's
  // internal tab (products/queries/etc.) since that audience still wants
  // a tab strip; it just isn't rendered until showAdminConsole is true.
  const [showAccountDrawer, setShowAccountDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState("saved");
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  // Bumped on every logo click, passed to ResearchTab as `key` below — the
  // simplest correct way to reset ALL of that component's internal state
  // (query text, an active result, the clarify loop, everything) on a
  // "go home" click without threading individual reset callbacks through
  // its already-large prop surface. React treats a key change as "this is
  // a new instance" and remounts it fresh, same as any other key-based reset.
  const [homeKey, setHomeKey] = useState(0);
  const goHome = useCallback(() => {
    setShowAdminConsole(false);
    setShowAccountDrawer(false);
    setHomeKey((k) => k + 1);
  }, []);
  const [upgrading, setUpgrading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [locale, setLocale] = useState(DEFAULT_LOCALE);

  // Resolve language once on mount: an explicit past choice wins, then a
  // ?lang= link, then the browser's own preference. Country is handled
  // server-side, where the visitor's location is actually known.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sllm_locale");
      const urlParam = new URLSearchParams(window.location.search).get("lang");
      const resolved = resolveLocale({
        stored,
        urlParam,
        acceptLanguage: navigator.language || "",
      });
      setLocale(resolved);
      document.documentElement.lang = LOCALES[resolved]?.htmlLang || "en";
    } catch { /* storage unavailable — English is a safe default */ }
  }, []);

  function changeLocale(next) {
    setLocale(next);
    try {
      localStorage.setItem("sllm_locale", next);
      document.documentElement.lang = LOCALES[next]?.htmlLang || "en";
    } catch { /* non-critical */ }
  }

  const tr = t(locale);
  const { isSignedIn, user } = useUser();
  const isAdminHint = useIsAdminClientHint();

  // Check for prior consent once, on mount. Stored client-side only —
  // this is a UX convenience (don't re-show the gate every visit), not a
  // legal record. The Privacy Policy / Terms text itself is the source of
  // truth for what was agreed to, and re-shows automatically if its
  // version changes (see CONSENT_VERSION below).
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sllm_consent_version");
      setConsented(stored === CONSENT_VERSION);
    } catch (e) {
      // localStorage unavailable (e.g. some privacy modes) — fail safe by
      // showing the consent gate rather than crashing.
      setConsented(false);
    }
  }, []);

  function handleAccept() {
    // Funnel measurement for the gate, sent to the dataLayer only — GA4
    // picks it up via GTM, so "landed → accepted → searched" is visible
    // without spending a database operation on every new session.
    trackEvent("consent_accepted", {});
    try {
      localStorage.setItem("sllm_consent_version", CONSENT_VERSION);
    } catch (e) {
      // Non-fatal — consent still applies for this session even if it
      // can't be remembered for next time.
    }
    setConsented(true);
  }

  const loadUsage = useCallback(async () => {
    try {
      const resp = await fetch("/api/usage");
      if (resp.ok) setUsage(await resp.json());
    } catch (e) {
      console.error("Failed to load usage", e);
    }
  }, []);

  useEffect(() => {
    if (consented) loadUsage();
  }, [consented, isSignedIn, loadUsage]);

  // Badge count only — the Alerts tab itself loads the full list (and
  // marks it seen) when opened. A separate lightweight call here so the
  // badge shows up even if the shopper never opens the tab that session.
  useEffect(() => {
    if (!consented) return;
    fetch("/api/watchlist")
      .then((r) => r.json())
      .then((d) => setWatchlistUnseen(d.unseen || 0))
      .catch(() => {});
  }, [consented, isSignedIn]);

  // Pays the flat platform fee to unlock the current 250-point block —
  // the only payment this app takes (2026-08-25: no more Plus plan).
  async function handlePayPlatformFee() {
    setUpgrading(true);
    try {
      const resp = await fetch("/api/checkout", { method: "POST" });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Previously this branch did nothing at all, so a misconfigured or
      // failing checkout looked like a dead button. Surface the reason.
      throw new Error(data.detail || data.error || "Checkout did not return a payment link");
    } catch (e) {
      console.error("Checkout failed", e);
      setCheckoutError(e.message || "Couldn't start the payment. Please try again.");
      setUpgrading(false);
    }
  }

  if (consented === null) {
    // Briefly loading prior-consent state from localStorage — avoid a
    // flash of the consent gate for returning users.
    return <div className="sllm-canvas" style={{ minHeight: "100vh" }} />;
  }

  if (!consented) {
    return (
      <div className="sllm-canvas" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <ConsentGate locale={locale} onAccept={handleAccept} />
      </div>
    );
  }

  const limit = usage?.limit ?? 8;
  const used = usage?.used ?? 0;
  // No plan tier (2026-08-25) — one saved-picks limit for everyone.
  const savedLimit = PLANS.free.savedPicks;
  const picksLeftLabel = limit === -1 ? "∞" : Math.max(0, limit - used);

  return (
    <div className="sllm-canvas" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {checkoutError && (
        <div style={{ padding: "8px 20px", background: "#FDF3F2", borderBottom: "0.5px solid #E8C9C6", fontSize: 12, color: "#A03530", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>Payment unavailable: {checkoutError}</span>
          <button onClick={() => setCheckoutError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A03530", fontSize: 12 }}>Dismiss</button>
        </div>
      )}

      <div className="sllm-header" style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div
          role="button"
          tabIndex={0}
          aria-label="SearchLLM.shop — back to home"
          onClick={goHome}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(); } }}
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
        >
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", color: "#14161A" }}>
            SearchLLM<span style={{ color: "#0F6E56" }}>.shop</span>
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", color: "#D97706", border: "1px solid #FCD34D99", background: "#FFFBEB", borderRadius: 999, padding: "2px 8px" }}>BETA</span>
        </div>

        <div className="sllm-header-right" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <nav style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Rewards as a first-class main-menu item (2026-09-02, explicit
                direction) — previously only reachable via the avatar's
                account drawer, which reads as a profile/settings area, not
                a feature every shopper should notice. This opens the same
                drawer (no duplicate implementation), just makes it
                discoverable from the nav bar itself, signed in or not. */}
            <button
              onClick={() => { setShowAdminConsole(false); setDrawerTab("rewards"); setShowAccountDrawer(true); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#854F0B", fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 4 }}
            >
              ⭐ Rewards
            </button>
            {SHOW_BRANDS_FORM && (
              <button onClick={() => { setShowAdminConsole(true); setActiveTab("brands"); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#4B5563", padding: 0 }}>For brands</button>
            )}
            <a href="/help#how-we-decide" style={{ fontSize: 13, color: "#4B5563", textDecoration: "none" }}>How we decide</a>
            <a href="/pricing" style={{ fontSize: 13, color: "#4B5563", textDecoration: "none" }}>Pricing</a>
            {isAdminHint && (
              <button onClick={() => { setShowAdminConsole(true); setActiveTab("admin"); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: showAdminConsole ? "#0F6E56" : "#4B5563", fontWeight: showAdminConsole ? 600 : 400, padding: 0 }}>Admin</button>
            )}
          </nav>

          <InstallApp />

          {usage?.points?.kind === "user" && (
            <button
              onClick={() => { setDrawerTab("rewards"); setShowAccountDrawer(true); }}
              title={usage.points.pending > 0 ? `${usage.points.pending} more points pending store confirmation` : "Your points — tap to view rewards"}
              className="sllm-points-chip"
              style={{ background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 12, padding: "3px 11px", fontSize: 12, fontWeight: 600, color: "#854F0B", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              ⭐ {Number(usage.points.balance).toLocaleString()} pts
            </button>
          )}
          {usage?.points?.kind === "guest" && usage.points.today > 0 && (
            <button
              onClick={() => { setDrawerTab("rewards"); setShowAccountDrawer(true); }}
              title="Guest points expire at midnight — sign in free to keep them and they'll keep adding up."
              className="sllm-points-chip"
              style={{ background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 12, padding: "3px 11px", fontSize: 12, fontWeight: 600, color: "#854F0B", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              ⭐ {usage.points.today} pts today<span className="sllm-chip-long"> · gone at midnight — sign in to keep</span>
            </button>
          )}

          {/* Usage pill — mirrors the "10/10 searches today" chip on
              searchllm.ai: monospace, always visible, no hunting for it.
              No plan tier (2026-08-25) — research is never limited for a
              signed-in account, so this only ever shows for guests. */}
          <span
            title={isSignedIn ? "Signed in — research is never limited" : "Guest daily limit"}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, color: "#4B5563", background: "#fff", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap" }}
          >
            {used}/{limit === -1 ? "∞" : limit} picks today
          </span>

          {ENABLE_GERMAN && (
          <select
            value={locale}
            onChange={(e) => changeLocale(e.target.value)}
            aria-label="Language"
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >
            {Object.values(LOCALES).map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          )}

          {isSignedIn ? (
            <button
              onClick={() => { setShowAdminConsole(false); setDrawerTab("saved"); setShowAccountDrawer(true); }}
              title={user?.primaryEmailAddress?.emailAddress}
              style={{ width: 32, height: 32, borderRadius: "50%", background: "#7C3AED", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              {(user?.primaryEmailAddress?.emailAddress || "?")[0].toUpperCase()}
            </button>
          ) : (
            <>
              <button
                onClick={() => { setShowAdminConsole(false); setDrawerTab("saved"); setShowAccountDrawer(true); }}
                title="Guest — saved picks and watchlist"
                style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-background-tertiary)", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                ?
              </button>
              <SignInButton mode="modal">
                <button style={{ background: "#3F3F46", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, color: "#fff", fontWeight: 500, whiteSpace: "nowrap" }}>Sign in</button>
              </SignInButton>
            </>
          )}
        </div>
      </div>

      {showAdminConsole ? (
        <>
          <div className="sllm-tabs" style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 24px", background: "#fff" }}>
            {["admin", "products", "queries", "performance", "answers", "reports", ...(SHOW_ADVERTISERS ? ["advertisers", "advertise"] : []), ...(SHOW_BRANDS_FORM ? ["brands"] : [])].map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setActiveTab(tabKey)}
                style={{ padding: "10px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: activeTab === tabKey ? 500 : 400, color: activeTab === tabKey ? "#0F6E56" : "var(--color-text-secondary)", borderBottom: `2px solid ${activeTab === tabKey ? "#0F6E56" : "transparent"}` }}
              >
                {tabKey === "admin" ? "Review queue" : tabKey === "brands" ? "For brands" : tabKey === "advertise" ? "Advertise" : tabKey}
              </button>
            ))}
          </div>
          <div className="sllm-main" style={{ flex: 1, padding: 24, maxWidth: 1100, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
            {activeTab === "brands" && SHOW_BRANDS_FORM && <BrandForm />}
            {activeTab === "advertise" && SHOW_ADVERTISERS && <AdvertiserPanel />}
            {activeTab === "advertisers" && SHOW_ADVERTISERS && <AdvertiserAdmin />}
            {activeTab === "admin" && <AdminQueue />}
            {activeTab === "products" && <ProductsBrowser />}
            {activeTab === "queries" && <QueriesPanel />}
            {activeTab === "performance" && <PerformancePanel />}
            {activeTab === "answers" && <AnswersAdmin />}
            {activeTab === "reports" && <ReportsPanel />}
          </div>
        </>
      ) : (
        <div className="sllm-main" style={{ flex: 1, padding: "20px 20px 40px", maxWidth: 780, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          {/* Rewards, shown prominently on the homepage itself — the
              platform-fee nudge in particular is meant to be seen every
              time a member reaches a 250-point milestone, not discovered
              by clicking into a profile section. No plan tier (2026-08-25):
              every account follows the same flat rule, so this is the same
              banner for everyone, always. */}
          {usage?.points?.kind === "user" && usage.points.atCeiling && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", background: "#FDF8EF", border: "1px solid #EADFC8", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#854F0B", lineHeight: 1.6 }}>
                ⭐ <strong>You&apos;ve earned {Number(usage.points.totalPoints).toLocaleString()} points!</strong> Pay the ₹{usage.points.platformFeeInr} platform fee to claim your ₹{LOYALTY.POINTS_BLOCK_SIZE} voucher and keep earning — or keep researching for free any time, no rush.
              </div>
              <button
                onClick={handlePayPlatformFee}
                disabled={upgrading}
                style={{ background: "#0F6E56", border: "none", borderRadius: 6, padding: "7px 16px", cursor: upgrading ? "default" : "pointer", fontSize: 12, color: "#fff", fontWeight: 500, opacity: upgrading ? 0.6 : 1, whiteSpace: "nowrap" }}
              >
                {upgrading ? "Redirecting…" : `Pay ₹${usage.points.platformFeeInr} platform fee`}
              </button>
            </div>
          )}
          {usage?.points?.kind === "user" && !usage.points.atCeiling && usage.points.totalPoints > 0 && (
            <button
              onClick={() => { setDrawerTab("rewards"); setShowAccountDrawer(true); }}
              style={{ display: "flex", width: "100%", boxSizing: "border-box", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "10px 16px", marginBottom: 14, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                ⭐ <strong style={{ color: "var(--color-text-primary)" }}>{Number(usage.points.totalPoints).toLocaleString()} / {Number(usage.points.ceiling).toLocaleString()} points</strong> toward your next gift voucher
              </span>
              <span style={{ height: 6, width: 120, borderRadius: 3, background: "var(--color-background-tertiary)", overflow: "hidden", flexShrink: 0 }}>
                <span style={{ display: "block", height: "100%", width: `${Math.min(100, (usage.points.totalPoints / usage.points.ceiling) * 100)}%`, background: "#0F6E56", borderRadius: 3 }} />
              </span>
            </button>
          )}
          <ResearchTab
            key={homeKey}
            isAdmin={isAdminHint}
            locale={locale}
            maxSearches={limit}
            searchCount={used}
            onSearchComplete={loadUsage}
            onSavePick={handleSavePick}
            savedQueries={savedPicks.map((p) => normaliseQuery(p.query))}
            saveNotice={saveNotice}
          />
        </div>
      )}

      {/* Account drawer: Saved picks / Watchlist / Rewards, opened from the
          avatar. Slide-over rather than a route change — keeps whatever
          research answer is on screen intact underneath. */}
      {showAccountDrawer && (
        <>
          <div onClick={() => setShowAccountDrawer(false)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.35)", zIndex: 40 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 100vw)", background: "var(--color-background-primary)", boxShadow: "-8px 0 24px rgba(16,24,40,0.12)", zIndex: 41, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="sllm-tabs sllm-drawer-tabs" style={{ display: "flex", gap: 4 }}>
                {["saved", "watchlist", "rewards"].map((dt) => (
                  <button
                    key={dt}
                    onClick={() => setDrawerTab(dt)}
                    style={{ padding: "6px 11px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: drawerTab === dt ? 600 : 400, background: drawerTab === dt ? "var(--color-background-tertiary)" : "none", color: drawerTab === dt ? "var(--color-text-primary)" : "var(--color-text-secondary)", textTransform: "capitalize", position: "relative" }}
                  >
                    {dt === "saved" ? tr("tabSaved") : dt === "watchlist" ? "Watchlist" : "Rewards"}
                    {dt === "watchlist" && watchlistUnseen > 0 && (
                      <span style={{ marginLeft: 5, background: "#D85A30", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>{watchlistUnseen}</span>
                    )}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAccountDrawer(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--color-text-tertiary)" }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              {isSignedIn ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span className="sllm-header-identity" style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{user?.primaryEmailAddress?.emailAddress}</span>
                  <SignOutButton>
                    <button style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)" }}>Sign out</button>
                  </SignOutButton>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 14, lineHeight: 1.6 }}>
                  Browsing as a guest — {tr("guest")} data stays on this device. <SignInButton mode="modal"><button style={{ background: "none", border: "none", padding: 0, color: "#0F6E56", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Sign in</button></SignInButton> to keep it everywhere.
                </div>
              )}

              {drawerTab === "watchlist" && <PriceAlerts onMarkSeen={() => setWatchlistUnseen(0)} />}
              {drawerTab === "rewards" && <RewardsTab />}
              {drawerTab === "saved" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "0 0 12px" }}>
              <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>{tr("savedPicks")}</h2>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {savedLimit === -1 ? `${savedPicks.length} ${tr("savedCount")}` : `${savedPicks.length} ${tr("savedOf")} ${savedLimit} ${tr("savedCount")}`}
              </span>
            </div>
            {savedPicks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--color-text-tertiary)", fontSize: 13 }}>Nothing saved yet.</div>
            ) : (
              savedPicks.map((p) => {
                const open = expandedPick === p.id;
                return (
                  <div key={p.id} style={{ background: "var(--color-background-secondary)", borderRadius: 10, border: "0.5px solid var(--color-border-tertiary)", padding: 14, marginBottom: 10 }}>
                    <div
                      onClick={() => setExpandedPick(open ? null : p.id)}
                      style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{p.query}</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{p.headline}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                        {open ? `${tr("hide")} ▲` : `${tr("view")} ▼`}
                      </span>
                    </div>

                    {/* The full answer as it was given, so a saved pick is a
                        record of the research rather than just a headline. */}
                    {open && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        {p.reasoning && (
                          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>{p.reasoning}</div>
                        )}
                        {p.whoItsFor && (
                          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                            <strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{tr("goodFor")}</strong> {p.whoItsFor}
                          </div>
                        )}
                        {p.whoShouldSkip && (
                          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>
                            <strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{tr("skipIf")}</strong> {p.whoShouldSkip}
                          </div>
                        )}

                        {p.matchedListing && (
                          <div style={{ background: "#BA75171A", borderRadius: 8, border: "0.5px solid #BA751744", padding: 10, marginBottom: 10, display: "flex", gap: 10, alignItems: "center" }}>
                            {p.matchedListing.imageUrl && (
                              <img src={p.matchedListing.imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 500 }}>{p.matchedListing.product}</div>
                              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                                {p.matchedListing.price} · sponsored via {p.matchedListing.network}
                              </div>
                            </div>
                            {/* Saved before the /out/ redirect existed may
                                lack a listing id — those fall back to the raw
                                network link rather than a dead button. */}
                            <a href={p.matchedListing.id ? `/out/${p.matchedListing.id}?ctx=research` : p.matchedListing.networkLink} target="_blank" rel="noopener noreferrer sponsored" style={{ fontSize: 11, color: "#854F0B", fontWeight: 500, whiteSpace: "nowrap" }}>
                              View →
                            </a>
                          </div>
                        )}

                        {p.alternatives?.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 6 }}>
                              {tr("alsoConsidered")}
                            </div>
                            {p.alternatives.map((a, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: "var(--color-text-secondary)", padding: "3px 0" }}>
                                <span>{a.name}</span>
                                <span style={{ whiteSpace: "nowrap" }}>{a.price}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                            {p.savedAt ? `Saved ${new Date(p.savedAt).toLocaleDateString()}` : ""}
                          </span>
                          <button onClick={() => removePick(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#D85A30" }}>
                            {tr("remove")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ padding: "16px 24px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
        {/* Policy links must be reachable from the site itself — payment
            providers check for them, and a shopper shouldn't have to hunt
            for the terms they agreed to. Styled as a plain link row to
            match the searchllm.ai footer pattern. */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <a href="/help#how-we-decide" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>How we decide</a>
          <a href="/privacy" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>Privacy Policy</a>
          <a href="/terms" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>Terms of Use</a>
          <a href="/refunds" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>Refunds</a>
          <a href="/pricing" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>Pricing</a>
          <a href="/contact" style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>Contact</a>
          {isAdminHint && (
            <button onClick={() => { setShowAdminConsole(true); setActiveTab("admin"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: "#4F46E5" }}>Admin</button>
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", lineHeight: 1.6, margin: 0, maxWidth: 720 }}>
          {tr("honestFooter")}. Sponsored listings are disclosed, human-reviewed, and structurally cannot influence an answer.
        </p>
      </div>
    </div>
  );
}
