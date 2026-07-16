"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton, SignOutButton } from "@clerk/nextjs";
import ConsentGate from "@/components/ConsentGate";
import ResearchTab from "@/components/ResearchTab";
import BrandForm from "@/components/BrandForm";
import AdminQueue from "@/components/AdminQueue";

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
  const [usage, setUsage] = useState(null); // { plan, limit, used }
  const [upgrading, setUpgrading] = useState(false);
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
      if (data.url) window.location.href = data.url;
    } catch (e) {
      console.error("Checkout failed", e);
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
        <ConsentGate onAccept={handleAccept} />
      </div>
    );
  }

  const limit = usage?.limit ?? 8;
  const used = usage?.used ?? 0;
  const plan = usage?.plan ?? "free";
  const picksLeftLabel = limit === -1 ? "∞" : Math.max(0, limit - used);

  return (
    <div style={{ minHeight: 600, display: "flex", flexDirection: "column", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 16, overflow: "hidden", background: "var(--color-background-primary)" }}>
      <div className="sllm-header" style={{ padding: "12px 20px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.04em", textTransform: "uppercase" }}>SearchLLM</span>
        <div className="sllm-header-right" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="sllm-header-identity" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {isSignedIn ? user?.primaryEmailAddress?.emailAddress : "Guest"} · {plan === "plus" ? "Plus" : "Free"} · {picksLeftLabel} picks left
          </span>
          {plan === "free" && isSignedIn && (
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
        {["research", "saved", "brands", ...(isAdminHint ? ["admin"] : [])].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{ padding: "9px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: activeTab === t ? 500 : 400, color: activeTab === t ? "#0F6E56" : "var(--color-text-secondary)", borderBottom: `2px solid ${activeTab === t ? "#0F6E56" : "transparent"}`, textTransform: "capitalize" }}
          >
            {t === "brands" ? "For brands" : t === "admin" ? "Review queue" : t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {activeTab === "research" && (
          <ResearchTab
            maxSearches={limit}
            searchCount={used}
            onSearchComplete={loadUsage}
            onSavePick={(pick) => setSavedPicks((p) => [pick, ...p])}
          />
        )}
        {activeTab === "saved" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Saved picks</h2>
            {savedPicks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--color-text-tertiary)", fontSize: 13 }}>Nothing saved yet.</div>
            ) : (
              savedPicks.map((p) => (
                <div key={p.id} style={{ background: "var(--color-background-secondary)", borderRadius: 10, border: "0.5px solid var(--color-border-tertiary)", padding: 14, marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{p.query}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.headline}</div>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === "brands" && <BrandForm />}
        {activeTab === "admin" && isAdminHint && <AdminQueue />}
      </div>

      <div style={{ padding: "9px 20px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>searchllm.shop</span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Honest recommendations, always disclosed</span>
      </div>
    </div>
  );
}
