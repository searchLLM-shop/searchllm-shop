"use client";

import { useState, useEffect, useCallback } from "react";

export default function AdvertiserAdmin() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/advertisers");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed");
      setData(json);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setBusy(id);
    try {
      await fetch("/api/admin/advertisers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally { setBusy(null); }
  }

  if (error) return <div style={{ fontSize: 12, color: "#A03530" }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: 20 }}>Loading…</div>;

  const totalDue = data.billing.reduce((s, b) => s + Number(b.commission_due || 0), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Direct advertisers</h3>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Commission owed to us: <strong>₹{totalDue.toLocaleString()}</strong>
        </span>
      </div>

      {data.billing.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>No advertisers yet.</div>
      ) : (
        data.billing.map((b) => (
          <div key={b.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 12, marginBottom: 10, background: "var(--color-background-secondary)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{b.company_name}</span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 8 }}>{b.contact_email}</span>
              </div>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: b.status === "approved" ? "#0F6E5622" : "var(--color-background-tertiary)", color: b.status === "approved" ? "#0F6E56" : "var(--color-text-secondary)" }}>
                {b.status}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 8 }}>
              {b.commission_model === "cps" ? `${b.commission_rate}% CPS` : `${b.currency} ${b.commission_rate} CPA`}
              {" · "}{b.clicks} clicks · {b.conversions} sales · {b.currency} {Number(b.sales_value).toLocaleString()} sales value
              {" · "}<strong style={{ color: "#854F0B" }}>due ₹{Number(b.commission_due).toLocaleString()}</strong>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["approved", "paused", "rejected"].filter((s) => s !== b.status).map((s) => (
                <button key={s} onClick={() => setStatus(b.id, s)} disabled={busy === b.id}
                  style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
