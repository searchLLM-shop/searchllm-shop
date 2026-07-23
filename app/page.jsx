"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton, SignOutButton } from "@clerk/nextjs";
import ConsentGate from "@/components/ConsentGate";
import ResearchTab from "@/components/ResearchTab";
import BrandForm from "@/components/BrandForm";
import AdminQueue from "@/components/AdminQueue";
import ReportsPanel from "@/components/ReportsPanel";
import { PLANS, SHOW_UPGRADE, SHOW_ADVERTISERS, SHOW_BRANDS_FORM, ENABLE_GERMAN } from "@/lib/constants";
import { LOCALES, DEFAULT_LOCALE, resolveLocale, t } from "@/lib/i18n";
import AdvertiserPanel from "@/components/AdvertiserPanel";
import AdvertiserAdmin from "@/components/AdvertiserAdmin";
import AnswersAdmin from "@/components/AnswersAdmin";
import ProductsBrowser from "@/components/ProductsBrowser";
import QueriesPanel from "@/components/QueriesPanel";
import PerformancePanel from "@/components/PerformancePanel";
import RewardsTab from "@/components/RewardsTab";

// Bump this whenever the Privacy Policy or Terms of Use changes materially
// — it invalidates stored consent and forces the gate to show again, which
// is what the Privacy Policy promises ("30 days' notice before any
// material change") in spirit, applied to first-party UX.
const CONSENT_VERSION = "2026-06-shop-v1";

// Tells the client whether to show the admin tab. This is a soft check for
// UI purposes only — the real enforcement happens server-side in
// /api/admin/listings, which re-checks ADMIN_EMAILS independently. Never
// trust this flag alone to gate sensitive actions.
function useIsAdminClientHint() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return email && adminEmails.includes(email.toLowerCase());
}

export default function Home() {
  const [consented, setConsented] = useState(null); // null = not yet checked
  const [activeTab, setActiveTab] = useState("research");
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
      setSaveNotice(`You've saved ${savedLimit} picks, the limit on the ${PLANS[plan]?.name || "Free"} plan. Remove one to save another.`);
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
  const [usage, setUsage] = useState(null); // { plan, limit, used }
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

  async function handleUpgrade() {
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
      setCheckoutError(e.message || "Couldn't start checkout. Please try again.");
      setUpgrading(false);
    }
  }

  if (consented === null) {
    // Briefly loading prior-consent state from localStorage — avoid a
    // flash of the consent gate for returning users.
    return <div style={{ minHeight: 600, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 16, background: "var(--color-background-primary)" }} />;
  }

  if (!consented) {
    return (
      <div style={{ minHeight: 600, display: "flex", flexDirection: "column", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 16, overflow: "hidden", background: "var(--color-background-primary)" }}>
        <ConsentGate locale={locale} onAccept={handleAccept} />
      </div>
    );
  }

  const limit = usage?.limit ?? 8;
  const used = usage?.used ?? 0;
  const plan = usage?.plan ?? "free";
  // Must come after `plan` — computing it earlier referenced `plan` before its
  // declaration, which threw "Cannot access 'H' before initialization" during
  // prerendering and failed the build.
  const savedLimit = PLANS[plan]?.savedPicks ?? PLANS.free.savedPicks;
  const picksLeftLabel = limit === -1 ? "∞" : Math.max(0, limit - used);

  return (
    <div style={{ minHeight: 600, display: "flex", flexDirection: "column", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 16, overflow: "hidden", background: "var(--color-background-primary)" }}>
      {checkoutError && (
        <div style={{ padding: "8px 20px", background: "#FDF3F2", borderBottom: "0.5px solid #E8C9C6", fontSize: 12, color: "#A03530", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>Upgrade unavailable: {checkoutError}</span>
          <button onClick={() => setCheckoutError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A03530", fontSize: 12 }}>Dismiss</button>
        </div>
      )}

      <div className="sllm-header" style={{ padding: "12px 20px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.04em", textTransform: "uppercase" }}>SearchLLM</span>
        <div className="sllm-header-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Points chip: earning must be VISIBLE to work as retention.
              Users see their live balance (tap → Rewards tab). Guests see
              today's day-points with the honest expiry note — the whole
              signup hook in twelve words. */}
          {usage?.points?.kind === "user" && (
            <button
              onClick={() => setActiveTab("rewards")}
              title={usage.points.pending > 0 ? `${usage.points.pending} more points pending store confirmation` : "Your points — tap to view rewards"}
              style={{ background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 12, padding: "3px 11px", fontSize: 12, fontWeight: 600, color: "#854F0B", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              ⭐ {Number(usage.points.balance).toLocaleString()} pts
            </button>
          )}
          {usage?.points?.kind === "guest" && usage.points.today > 0 && (
            <button
              onClick={() => setActiveTab("rewards")}
              title="Guest points expire at midnight — sign in free to keep them and they'll keep adding up."
              style={{ background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 12, padding: "3px 11px", fontSize: 12, fontWeight: 600, color: "#854F0B", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              ⭐ {usage.points.today} pts today · gone at midnight — sign in to keep
            </button>
          )}
          <span className="sllm-header-identity" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {isSignedIn ? user?.primaryEmailAddress?.emailAddress : tr("guest")} · {plan === "plus" ? tr("plus") : tr("free")} · {picksLeftLabel} {tr("picksLeft")}
          </span>
          {/* Language switcher. Sits beside the account details so a German
              visitor can correct an auto-detected language immediately.
              Hidden entirely while ENABLE_GERMAN is off — it sets the locale
              directly, so leaving it visible would bypass the pause. */}
          {ENABLE_GERMAN && (
          <select
            value={locale}
            onChange={(e) => changeLocale(e.target.value)}
            aria-label="Language"
            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-secondary)", marginRight: 8, cursor: "pointer" }}
          >
            {Object.values(LOCALES).map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          )}

          {SHOW_UPGRADE && plan === "free" && isSignedIn && (
            <button onClick={handleUpgrade} disabled={upgrading} style={{ background: "#0F6E56", border: "none", borderRadius: 6, padding: "5px 12px", cursor: upgrading ? "default" : "pointer", fontSize: 11, color: "#fff", fontWeight: 500, opacity: upgrading ? 0.6 : 1 }}>
              {upgrading ? "Redirecting…" : "Upgrade to Plus"}
            </button>
          )}
          {isSignedIn ? (
            <SignOutButton>
              <button style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)" }}>Sign out</button>
            </SignOutButton>
          ) : (
            <SignInButton mode="modal">
              <button style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)" }}>Sign in</button>
            </SignInButton>
          )}
        </div>
      </div>

      <div className="sllm-tabs" style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        {["research", "saved", "rewards", ...(SHOW_BRANDS_FORM ? ["brands"] : []), ...(SHOW_ADVERTISERS ? ["advertise"] : []), ...(isAdminHint ? ["admin", "products", "queries", "performance", "answers", "reports", ...(SHOW_ADVERTISERS ? ["advertisers"] : [])] : [])].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{ padding: "9px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: activeTab === t ? 500 : 400, color: activeTab === t ? "#0F6E56" : "var(--color-text-secondary)", borderBottom: `2px solid ${activeTab === t ? "#0F6E56" : "transparent"}`, textTransform: "capitalize" }}
          >
            {/* Shopper-facing tabs are translated; admin tabs stay English. */}
            {t === "research"
              ? tr("tabResearch")
              : t === "saved"
              ? tr("tabSaved")
              : t === "rewards"
              ? "Rewards"
              : t === "brands"
              ? "For brands"
              : t === "admin"
              ? "Review queue"
              : t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {activeTab === "research" && (
          <ResearchTab
            isAdmin={isAdminHint}
            locale={locale}
            maxSearches={limit}
            searchCount={used}
            onSearchComplete={loadUsage}
            onSavePick={handleSavePick}
            savedQueries={savedPicks.map((p) => normaliseQuery(p.query))}
            saveNotice={saveNotice}
          />
        )}
        {activeTab === "rewards" && <RewardsTab />}
        {activeTab === "saved" && (
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
        {activeTab === "brands" && SHOW_BRANDS_FORM && <BrandForm />}
        {activeTab === "advertise" && SHOW_ADVERTISERS && <AdvertiserPanel />}
        {activeTab === "advertisers" && isAdminHint && SHOW_ADVERTISERS && <AdvertiserAdmin />}
        {activeTab === "admin" && isAdminHint && <AdminQueue />}
        {activeTab === "products" && isAdminHint && <ProductsBrowser />}
        {activeTab === "queries" && isAdminHint && <QueriesPanel />}
        {activeTab === "performance" && isAdminHint && <PerformancePanel />}
        {activeTab === "answers" && isAdminHint && <AnswersAdmin />}
        {activeTab === "reports" && isAdminHint && <ReportsPanel />}
      </div>

      <div style={{ padding: "9px 20px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>searchllm.shop</span>
        {/* Policy links must be reachable from the site itself — payment
            providers check for them, and a shopper shouldn't have to hunt
            for the terms they agreed to. */}
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/privacy" style={{ color: "inherit", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ color: "inherit", textDecoration: "none" }}>Terms</a>
          <a href="/refunds" style={{ color: "inherit", textDecoration: "none" }}>Refunds</a>
          <a href="/pricing" style={{ color: "inherit", textDecoration: "none" }}>Pricing</a>
          <a href="/contact" style={{ color: "inherit", textDecoration: "none" }}>Contact</a>
        </span>
        <span className="sllm-footer-tag" style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{tr("honestFooter")}</span>
      </div>
    </div>
  );
}
