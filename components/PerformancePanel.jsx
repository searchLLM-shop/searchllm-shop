"use client";

// Product performance across all networks: every product that has been
// clicked through /out/ in the window, with what the networks confirmed
// about conversions. Ordered by conversions first, then clicks — sales
// truth at the top. Conversion figures depend on the daily conversion poll
// having a working network endpoint; until then this shows clicks only.

import { useState, useEffect, useCallback } from "react";

const n = (v) => Number(v || 0).toLocaleString();

export default function PerformancePanel() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/performance?days=${days}&page=${page}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.detail || json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days, page]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  const items = data.items || [];
  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 50)));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Performance</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => { setDays(d); setPage(1); }} style={{ background: days === d ? "#0F6E56" : "none", color: days === d ? "#fff" : "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{d}d</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        Every product clicked through a tracked link in the window, best sellers first. Conversions settle over 30–90 days — pending means inside the return window.
      </div>

      {(data.byCategory || []).length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>By category</div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 60px 100px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
              <span>Category</span><span style={{ textAlign: "right" }}>Clicks</span><span style={{ textAlign: "right" }}>Conv</span><span style={{ textAlign: "right" }}>Approved</span><span style={{ textAlign: "right" }}>Commission</span>
            </div>
            {data.byCategory.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 60px 100px", gap: 8, padding: "7px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                <span style={{ textAlign: "right" }}>{n(c.clicks)}</span>
                <span style={{ textAlign: "right", fontWeight: Number(c.conversions) > 0 ? 600 : 400, color: Number(c.conversions) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{n(c.conversions)}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-tertiary)" }}>{n(c.approved)}</span>
                <span style={{ textAlign: "right", fontWeight: Number(c.commission) > 0 ? 500 : 400, color: Number(c.commission) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{Number(c.commission) > 0 ? `${n(c.commission)} ${c.currency || ""}` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>
          No tracked clicks in this window yet. Rows appear as soon as shoppers click through recommendations.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, fontSize: 11, color: "var(--color-text-tertiary)", gap: 6, alignItems: "center" }}>
            <span>{n(data.total)} products clicked</span>
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>‹ Prev</button>
            <span>page {page} / {n(pages)}</span>
            <button disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page >= pages ? "default" : "pointer", opacity: page >= pages ? 0.4 : 1 }}>Next ›</button>
          </div>

          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "34px 1fr 55px 55px 70px 90px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
              <span></span><span>Product</span><span style={{ textAlign: "right" }}>Clicks</span><span style={{ textAlign: "right" }}>Conv</span><span style={{ textAlign: "right" }}>Status</span><span style={{ textAlign: "right" }}>Commission</span>
            </div>
            {items.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "34px 1fr 55px 55px 70px 90px", gap: 8, padding: "7px 12px", fontSize: 12, alignItems: "center", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6, background: "var(--color-background-tertiary)" }} />
                ) : (
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: "var(--color-background-tertiary)" }} />
                )}
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.product}
                  <span style={{ color: "var(--color-text-tertiary)" }}> · {p.brand} · {p.network}</span>
                </span>
                <span style={{ textAlign: "right" }}>{n(p.clicks)}</span>
                <span style={{ textAlign: "right", fontWeight: Number(p.conversions) > 0 ? 600 : 400, color: Number(p.conversions) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{n(p.conversions)}</span>
                <span style={{ textAlign: "right", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  {Number(p.conversions) > 0
                    ? [Number(p.approved) > 0 ? `${n(p.approved)} ok` : null, Number(p.pending) > 0 ? `${n(p.pending)} pend` : null, Number(p.declined) > 0 ? `${n(p.declined)} dec` : null].filter(Boolean).join(" · ")
                    : "—"}
                </span>
                <span style={{ textAlign: "right", fontWeight: Number(p.commission) > 0 ? 500 : 400, color: Number(p.commission) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>
                  {Number(p.commission) > 0 ? `${n(p.commission)} ${p.currency || ""}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
