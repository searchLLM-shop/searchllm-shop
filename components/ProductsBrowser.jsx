"use client";

// Admin product browser: pick a network, see every APPROVED product it has
// contributed with full details, paginated. Approved is the deliberate
// scope — it's the inventory a shopper can actually be shown.

import { useState, useEffect, useCallback } from "react";

const n = (v) => Number(v || 0).toLocaleString();

export default function ProductsBrowser() {
  const [networks, setNetworks] = useState([]);
  const [network, setNetwork] = useState(null);
  const [category, setCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/admin/products");
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.detail || json.error);
        setNetworks(json.networks || []);
        // Preselect the network with the most approved products — the one
        // an admin almost always came here to look at.
        const first = (json.networks || []).slice().sort((a, b) => Number(b.approved) - Number(a.approved))[0];
        if (first) setNetwork(first.network);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadPage = useCallback(async (net, p, cat) => {
    if (!net) return;
    setLoading(true);
    setError(null);
    try {
      const catParam = cat ? `&category=${encodeURIComponent(cat)}` : "";
      const resp = await fetch(`/api/admin/products?network=${encodeURIComponent(net)}&page=${p}${catParam}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.detail || json.error);
      setItems(json.items || []);
      setTotal(json.total || 0);
      setPageSize(json.pageSize || 50);
      setCategories(json.categories || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (network) { setPage(1); setCategory(null); loadPage(network, 1, null); } }, [network, loadPage]);
  useEffect(() => { if (network) { setPage(1); loadPage(network, 1, category); } }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (network) loadPage(network, page, category); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Products</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {networks.map((x) => (
          <button
            key={x.network}
            onClick={() => setNetwork(x.network)}
            style={{
              background: network === x.network ? "#0F6E56" : "var(--color-background-secondary)",
              color: network === x.network ? "#fff" : "var(--color-text-secondary)",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer",
            }}
          >
            {x.network} · {n(x.approved)} approved
          </button>
        ))}
      </div>

      {network && categories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            onClick={() => setCategory(null)}
            style={{ background: category === null ? "#854F0B" : "none", color: category === null ? "#fff" : "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 12, padding: "3px 10px", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}
          >
            all
          </button>
          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => setCategory(category === c.category ? null : c.category)}
              style={{ background: category === c.category ? "#854F0B" : "none", color: category === c.category ? "#fff" : "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 12, padding: "3px 10px", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}
            >
              {c.category} · {Number(c.total).toLocaleString()}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {network && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 12, color: "var(--color-text-tertiary)" }}>
          <span>{n(total)} approved products on {network}{category ? ` · ${category}` : ""}</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>‹ Prev</button>
            <span>page {page} / {n(pages)}</span>
            <button disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} style={{ border: "0.5px solid var(--color-border-secondary)", background: "none", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: page >= pages ? "default" : "pointer", opacity: page >= pages ? 0.4 : 1 }}>Next ›</button>
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>
          No approved products on this network yet — approve some in the review queue first.
        </div>
      ) : (
        <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
          {items.map((p, i) => (
            <div key={p.id} style={{ borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
              <div
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, background: "var(--color-background-tertiary)", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: "var(--color-background-tertiary)", flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.product}
                  <span style={{ color: "var(--color-text-tertiary)" }}> · {p.brand}</span>
                </span>
                <span style={{ whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>{p.price}</span>
                {p.rating && <span style={{ whiteSpace: "nowrap", fontSize: 11, color: "var(--color-text-tertiary)" }}>★ {p.rating}{p.ratingCount ? ` (${n(p.ratingCount)})` : ""}</span>}
              </div>
              {expanded === p.id && (
                <div style={{ padding: "0 12px 10px 56px", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                  <div><span style={{ color: "var(--color-text-tertiary)" }}>Category:</span> {p.category || "—"}
                    {p.discount ? <span> · <span style={{ color: "var(--color-text-tertiary)" }}>Discount:</span> {p.discount}</span> : null}
                    {Array.isArray(p.regions) && p.regions.length ? <span> · <span style={{ color: "var(--color-text-tertiary)" }}>Regions:</span> {p.regions.join(", ")}</span> : null}
                    {p.merchantDomain ? <span> · {p.merchantDomain}</span> : null}
                  </div>
                  {Array.isArray(p.keywords) && p.keywords.length > 0 && (
                    <div><span style={{ color: "var(--color-text-tertiary)" }}>Keywords:</span> {p.keywords.join(", ")}</div>
                  )}
                  <div style={{ marginTop: 4 }}>
                    <a href={`/out/${p.id}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0F6E56", fontWeight: 500 }}>
                      Open tracked link →
                    </a>
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}> (goes through /out/ — records a real click)</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
