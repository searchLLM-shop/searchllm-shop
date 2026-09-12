"use client";

// The Referrals tab. Registered users only — a signed-out visitor sees a
// sign-in prompt, same shape as RewardsTab.jsx. A signed-in user gets their
// own permanent share link and a WhatsApp share button (a wa.me deep link —
// this platform never sends anything itself and never sees a friend's
// phone number; sharing happens entirely through the referrer's own
// WhatsApp). Each CONFIRMED new registration earns a flat number of
// points, capped for life — see lib/constants.js's REFERRALS config and
// lib/db.js's confirmReferral for how "confirmed" is actually decided.

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";

const n = (v) => Number(v || 0).toLocaleString();

export default function ReferralsTab() {
  const { isSignedIn } = useUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!isSignedIn) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/referrals");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (!isSignedIn) {
    return (
      <div style={{ textAlign: "center", padding: "40px 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Refer friends, earn points</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 460, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Share your own link with friends on WhatsApp — when they register, you earn points. Sign in to get your link, free.
        </p>
        <SignInButton mode="modal">
          <button style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Sign in to get started
          </button>
        </SignInButton>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Refer friends, earn points</h2>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
        Share your link with friends — when someone registers using it for the first time, you earn {n(data.pointsPerReferral)} points. Up to {n(data.maxReferrals)} friends total. We never send anything ourselves and never see your friend&apos;s phone number — sharing happens through your own WhatsApp.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Friends referred</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{n(data.referralsMade)} / {n(data.maxReferrals)}</div>
        </div>
        <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Points earned</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: "#0F6E56", lineHeight: 1.1 }}>{n(data.pointsEarned)}</div>
        </div>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Your referral link</div>
        {data.capped ? (
          <div style={{ fontSize: 12, color: "#854F0B", background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
            You&apos;ve referred the maximum of {n(data.maxReferrals)} friends — thank you! Your link stays active, but further registrations through it won&apos;t earn more points.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <code style={{ flex: "1 1 220px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "var(--color-background-tertiary)" }}>
                {data.link}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(data.link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 14px", fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <a
              href={data.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#25D366", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 500, textDecoration: "none" }}
            >
              Share on WhatsApp
            </a>
          </>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Referral history</div>
        {data.history.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            No confirmed referrals yet — share your link above to get started.
          </div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.history.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1 }}>Friend registered</span>
                <span style={{ fontWeight: 600, color: "#0F6E56" }}>+{n(h.points)}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{new Date(h.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
