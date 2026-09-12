"use client";

// Read-only admin report on the referral programme — total referrals,
// total points given out, unique referrers, and a leaderboard. Same
// styling conventions as ReportsPanel.jsx (Stat tiles), no per-row action
// needed since there's nothing here for an admin to DO, only to see.

import { useState, useEffect, useCallback } from "react";

function Stat({ label, value, accent }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent || "var(--color-text-primary)", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

const n = (v) => Number(v || 0).toLocaleString();

export default function ReferralsAdmin() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/referrals");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 24 }}>
        <Stat label="Total referrals" value={n(data.totalReferrals)} />
        <Stat label="Points given" value={n(data.totalPoints)} accent="#0F6E56" />
        <Stat label="Unique referrers" value={n(data.uniqueReferrers)} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Top referrers</div>
      {data.topReferrers.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No referrals yet.</div>
      ) : (
        <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 140px", padding: "8px 12px", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", background: "var(--color-background-secondary)" }}>
            <span>Referrer</span><span>Referrals</span><span>Points</span><span>Last referral</span>
          </div>
          {data.topReferrers.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 140px", padding: "8px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.displayIdentity}</span>
              <span>{n(r.referrals)}</span>
              <span style={{ color: "#0F6E56", fontWeight: 500 }}>{n(r.points)}</span>
              <span style={{ color: "var(--color-text-tertiary)" }}>{r.lastReferralAt ? new Date(r.lastReferralAt).toLocaleDateString() : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
