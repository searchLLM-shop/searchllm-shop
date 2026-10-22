"use client";

// The shopper's shopping list (account drawer tab). Each item is either a
// product from our partner stores ("Buy" goes through the tracked /out link)
// or a generic item with quick-commerce search links, or both. Items can be
// ticked off, removed, and the whole list sent to WhatsApp or copied.

import { useState, useEffect, useCallback } from "react";

const btn = { padding: "5px 11px", fontSize: 12, borderRadius: 7, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", cursor: "pointer", color: "inherit", textDecoration: "none", whiteSpace: "nowrap" };

export default function ShoppingList() {
  const [items, setItems] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [max, setMax] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/shopping-list");
      const json = await resp.json();
      setItems(json.items || []);
      setPlatforms(json.platforms || []);
      setMax(json.max || 50);
      setError(null);
    } catch {
      setError("Couldn't load your list — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(it) {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, bought: !x.bought } : x)));
    fetch("/api/shopping-list", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id, bought: !it.bought }) }).catch(load);
  }
  async function remove(it) {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    fetch(`/api/shopping-list?id=${it.id}`, { method: "DELETE" }).catch(load);
  }

  // Plain-text version of the list, with the same tracked links, for WhatsApp / copy.
  function listText() {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://www.searchllm.shop";
    const lines = ["My shopping list (SearchLLM.shop)", ""];
    items.filter((x) => !x.bought).forEach((it) => {
      lines.push(`• ${it.listingId ? [it.brand, it.product].filter(Boolean).join(" ") || it.title : it.title}${it.price ? ` — ${it.price}` : ""}`);
      if (it.listingId) lines.push(`  Buy: ${origin}/out/${it.listingId}?ctx=list`);
      if (it.qcTerm) platforms.forEach((p) => lines.push(`  ${p.name}: ${origin}/qc?p=${p.id}&q=${encodeURIComponent(it.qcTerm)}`));
    });
    return lines.join("\n");
  }
  async function copy() {
    try { await navigator.clipboard.writeText(listText()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("Couldn't copy — use the WhatsApp button instead."); }
  }

  if (loading) return <div style={{ textAlign: "center", padding: 30, fontSize: 13, color: "var(--color-text-tertiary)" }}>Loading…</div>;

  const open = items.filter((x) => !x.bought);
  const done = items.filter((x) => x.bought);

  return (
    <div>
      {error && <div style={{ fontSize: 12, color: "#A03530", marginBottom: 10 }}>{error}</div>}

      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 20px", fontSize: 13, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
          Your shopping list is empty. Tap &ldquo;＋ Add to list&rdquo; on a pick, or on the &ldquo;Need it fast?&rdquo; box, and everything you&apos;ve decided to buy will be here — with one-tap links to buy it.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <a href={`https://wa.me/?text=${encodeURIComponent(listText())}`} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: "#0F6E56", color: "#fff", border: "none" }}>Send to WhatsApp</a>
            <button onClick={copy} style={btn}>{copied ? "Copied ✓" : "Copy list"}</button>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", alignSelf: "center" }}>{items.length}/{max}</span>
          </div>

          {[...open, ...done].map((it) => (
            <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 10, marginBottom: 8, opacity: it.bought ? 0.55 : 1 }}>
              <input type="checkbox" checked={it.bought} onChange={() => toggle(it)} aria-label="Mark as bought" style={{ marginTop: 4 }} />
              {it.imageUrl && (
                <img src={it.imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, flexShrink: 0, border: "0.5px solid var(--color-border-tertiary)" }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, textDecoration: it.bought ? "line-through" : "none" }}>
                  {it.listingId ? [it.brand, it.product].filter(Boolean).join(" ") || it.title : it.title}
                </div>
                {it.price && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{it.price}</div>}
                {!it.bought && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {it.listingId && (
                      <a href={`/out/${it.listingId}?ctx=list`} target="_blank" rel="noopener noreferrer sponsored" style={{ ...btn, background: "#854F0B", color: "#fff", border: "none" }}>
                        {it.merchantDomain ? `Buy on ${it.merchantDomain.replace(/^www\./, "")}` : "Buy"} →
                      </a>
                    )}
                    {it.qcTerm && platforms.map((p) => (
                      <a key={p.id} href={`/qc?p=${p.id}&q=${encodeURIComponent(it.qcTerm)}`} target="_blank" rel="noopener noreferrer nofollow" style={btn}>
                        ⚡ {p.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => remove(it)} aria-label="Remove from list" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--color-text-tertiary)" }}>✕</button>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", lineHeight: 1.5, marginTop: 10 }}>
            &ldquo;Buy&rdquo; links to our partner stores are affiliate links — same price for you. The ⚡ links are plain search links to each quick-delivery app; availability, price and delivery time depend on your location.
          </div>
        </>
      )}
    </div>
  );
}
