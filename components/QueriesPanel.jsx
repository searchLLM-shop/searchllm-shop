"use client";

// What shoppers are searching for — stored anonymously (no identity, ever;
// see the search_queries DDL). The "top unmatched" table is the actionable
// half: it is, verbatim, the feed request list for the affiliate networks.

import { useState, useEffect, useCallback } from "react";

const n = (v) => Number(v || 0).toLocaleString();

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent || "var(--color-text-primary)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function QueryTable({ rows, showMatched }) {
  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.query}</span>
          {showMatched && (
            <span style={{ fontSize: 11, whiteSpace: "nowrap", color: Number(r.matched) > 0 ? "#0F6E56" : "#854F0B" }}>
              {Number(r.matched) > 0 ? `${n(r.matched)} matched` : "never matched"}
            </span>
          )}
          <span style={{ width: 40, textAlign: "right", fontWeight: 500 }}>{n(r.searches)}</span>
        </div>
      ))}
    </div>
  );
}

export default function QueriesPanel() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/queries?days=${days}&page=${page}`);
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

  const t = data.totals || {};
  const matchRate = Number(t.searches) > 0 ? ((Number(t.matched) / Number(t.searches)) * 100).toFixed(0) : "0";
  const recent = data.recent || { items: [], total: 0 };
  const pages = Math.max(1, Math.ceil(recent.total / (data.pageSize || 50)));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Queries</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => { setDays(d); setPage(1); }} style={{ background: days === d ? "#0F6E56" : "none", color: days === d ? "#fff" : "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{d}d</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
        Queries are logged anonymously — never linked to a user. Collection starts from this deploy onward.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        <Stat label="Searches" value={n(t.searches)} sub={`last ${days} days`} />
        <Stat label="Distinct queries" value={n(t.distinct_queries)} />
        <Stat label="Match rate" value={`${matchRate}%`} sub="had a relevant offer" accent={Number(matchRate) < 50 ? "#854F0B" : "#0F6E56"} />
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Top unmatched queries</div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
          The inventory gap, ranked. This list — as written — is what to ask the networks to provide feeds for.
        </div>
        {(!data.topUnmatched || data.topUnmatched.length === 0)
          ? <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Nothing unmatched in this window.</div>
          : <QueryTable rows={data.topUnmatched} showMatched={false} />}
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Top queries overall</div>
        {(!data.top || data.top.length === 0)
          ? <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No queries logged yet.</div>
          : <QueryTable rows={data.top} showMatched={true} />}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Recent queries — exact phrasing</div>
          <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--color-text-tertiary)" }}>
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>‹ Prev</button>
            <span>page {page} / {n(pages)}</span>
            <button disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page >= pages ? "default" : "pointer", opacity: page >= pages ? 0.4 : 1 }}>Next ›</button>
          </span>
        </div>
        {recent.items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Nothing yet.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden", maxHeight: 380, overflowY: "auto" }}>
            {recent.items.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.query}</span>
                <span style={{ fontSize: 11, whiteSpace: "nowrap", color: r.matched ? "#0F6E56" : "#854F0B" }}>{r.matched ? (r.network || "matched") : "no match"}</span>
                {r.country && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{r.country}</span>}
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
