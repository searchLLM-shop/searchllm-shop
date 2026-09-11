"use client";

// components/VcommissionPurchasesAdmin.jsx
//
// Admin-attested vCommission (Shopsy/Myntra) purchase points. vCommission
// periodically sends a report of confirmed purchases with commission paid —
// this panel lets an admin cross-reference that report by date, find the
// matching click, and enter the commission. 25% becomes reward points,
// credited automatically (app/api/admin/vcommission-purchases/route.js).
// Modeled on the redemption-queue pattern in AdminQueue.jsx: page/PAGE_SIZE
// pagination, per-row busy/error maps rather than a global spinner.

import { useState, useCallback, useEffect } from "react";

export default function VcommissionPurchasesAdmin() {
  const [clicks, setClicks] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [drafts, setDrafts] = useState({}); // { [clickId]: commission input value }
  const [busy, setBusy] = useState(null); // clickId currently submitting
  const [rowErrors, setRowErrors] = useState({}); // { [clickId]: reason }
  const PAGE_SIZE = 50;

  const load = useCallback(async (pageIndex = 0) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
      });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const resp = await fetch(`/api/admin/vcommission-purchases?${params}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Could not load clicks");
      setClicks(data.clicks || []);
      setTotal(data.total || 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { setPage(0); load(0); }, [load]);

  async function submit(clickId) {
    const raw = drafts[clickId];
    const commission = Number(raw);
    if (!raw || !Number.isFinite(commission) || commission <= 0) {
      setRowErrors((e) => ({ ...e, [clickId]: "Enter a positive commission amount" }));
      return;
    }
    setBusy(clickId);
    setRowErrors((e) => ({ ...e, [clickId]: undefined }));
    try {
      const resp = await fetch("/api/admin/vcommission-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clickId, commission }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.ok) {
        setRowErrors((e) => ({ ...e, [clickId]: data.reason || data.error || "Could not credit points" }));
        return;
      }
      // Reflect the credited state in place rather than a full reload.
      setClicks((prev) =>
        prev.map((c) =>
          c.click_id === clickId ? { ...c, commission, credited_points: data.points } : c
        )
      );
    } catch (e) {
      setRowErrors((e2) => ({ ...e2, [clickId]: e.message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
        Cross-reference vCommission&apos;s purchase report against the clicks below by date and
        product, then enter the commission it reports for that purchase — 25% becomes reward
        points, credited automatically to whichever user made the click. Rows marked
        &quot;not eligible&quot; are guest clicks or predate that user joining rewards, and can&apos;t
        earn points regardless of commission entered.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 6px", fontSize: 11, background: "none", color: "var(--color-text-primary)" }}
        />
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 6px", fontSize: 11, background: "none", color: "var(--color-text-primary)" }}
        />
        {(from || to) && (
          <button
            onClick={() => { setFrom(""); setTo(""); }}
            style={{ background: "none", border: "none", color: "var(--color-text-tertiary)", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}
          >
            Clear
          </button>
        )}
      </div>

      {errorMsg && (
        <div style={{ background: "#D85A3011", border: "1px solid #D85A3044", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#D85A30", marginBottom: 12 }}>
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>
      ) : clicks.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--color-text-tertiary)", fontSize: 13 }}>No vCommission clicks in this range.</div>
      ) : (
        clicks.map((c) => (
          <div key={c.click_id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {c.product || "(unknown product)"}{c.brand ? ` — ${c.brand}` : ""}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                  {new Date(c.created_at).toLocaleString("en-IN")} · {c.displayIdentity}
                  {c.merchant_domain ? ` · ${c.merchant_domain}` : ""}
                </div>
                {!c.eligible && (
                  <div style={{ fontSize: 11, color: "#D85A30", marginTop: 4 }}>
                    Not eligible — guest click, or predates this user joining rewards.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {c.credited_points != null ? (
                  <span style={{ fontSize: 12, color: "#0F6E56", fontWeight: 500 }}>
                    ✓ {c.credited_points} pts credited (₹{c.commission} commission)
                  </span>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>₹</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!c.eligible || busy === c.click_id}
                      value={drafts[c.click_id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.click_id]: e.target.value }))}
                      placeholder="commission"
                      style={{ width: 100, border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 8px", fontSize: 12, background: c.eligible ? "none" : "var(--color-background-tertiary)" }}
                    />
                    <button
                      onClick={() => submit(c.click_id)}
                      disabled={!c.eligible || busy === c.click_id}
                      style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: c.eligible ? "pointer" : "default", opacity: !c.eligible || busy === c.click_id ? 0.6 : 1 }}
                    >
                      {busy === c.click_id ? "Crediting…" : "Credit"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {rowErrors[c.click_id] && (
              <div style={{ fontSize: 11, color: "#D85A30", marginTop: 8 }}>{rowErrors[c.click_id]}</div>
            )}
          </div>
        ))
      )}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12 }}>
          <button
            onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p); }}
            disabled={page === 0 || loading}
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: page === 0 ? "default" : "pointer", color: "var(--color-text-secondary)", opacity: page === 0 ? 0.5 : 1 }}
          >
            ← Previous
          </button>
          <span style={{ color: "var(--color-text-tertiary)" }}>
            Page {page + 1} of {Math.ceil(total / PAGE_SIZE).toLocaleString()}
          </span>
          <button
            onClick={() => { const p = page + 1; setPage(p); load(p); }}
            disabled={(page + 1) * PAGE_SIZE >= total || loading}
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
