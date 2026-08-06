"use client";

// components/PriceAlerts.jsx
//
// Two things in one panel: the shopper's active watches (with how far each
// has moved since they started watching) and a feed of drops that have
// already fired. Kept as a single component/tab rather than splitting
// "watchlist" and "alerts" — for a list this short, one panel a shopper can
// scan in one glance beats navigating between two.

import { useState, useEffect, useCallback } from "react";

export default function PriceAlerts({ onMarkSeen }) {
  const [loading, setLoading] = useState(true);
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/watchlist");
      const data = await resp.json();
      setWatches(data.watches || []);
      setAlerts(data.alerts || []);
      setError(null);
    } catch (e) {
      setError("Couldn't load your watchlist — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Opening this tab is the read receipt — clears the header badge.
    fetch("/api/watchlist", { method: "PATCH" }).then(() => onMarkSeen?.()).catch(() => {});
  }, [load, onMarkSeen]);

  async function handleRemove(listingId) {
    setRemovingId(listingId);
    try {
      await fetch(`/api/watchlist?listingId=${listingId}`, { method: "DELETE" });
      setWatches((w) => w.filter((x) => x.listingId !== listingId));
    } catch (e) {
      // Non-fatal — the button just stays; a retry will work.
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div>
      {error && (
        <div style={{ fontSize: 12, color: "#A03530", marginBottom: 12 }}>{error}</div>
      )}

      {alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)", margin: "0 0 10px" }}>
            Price drops
          </h3>
          {alerts.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", background: "#0F6E561A", border: "0.5px solid #0F6E5644", borderRadius: 10, padding: 10, marginBottom: 8 }}>
              {a.imageUrl && (
                <img src={a.imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 40, height: 40, objectFit: "contain", background: "#fff", borderRadius: 6, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{[a.brand, a.product].filter(Boolean).join(" ")}</div>
                <div style={{ fontSize: 11, color: "#0F6E56" }}>
                  {a.oldPrice != null ? `₹${Number(a.oldPrice).toLocaleString()} → ` : ""}₹{Number(a.newPrice).toLocaleString()}
                </div>
              </div>
              <a href={`/out/${a.listingId}?ctx=watchlist`} target="_blank" rel="noopener noreferrer sponsored" style={{ fontSize: 11, fontWeight: 500, color: "#0F6E56", whiteSpace: "nowrap" }}>
                View →
              </a>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)", margin: "0 0 10px" }}>
        Watching ({watches.length})
      </h3>

      {watches.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--color-text-tertiary)", fontSize: 13 }}>
          Nothing on your watchlist yet. Tap &quot;Watch price&quot; on a research pick to get notified when it drops.
        </div>
      ) : (
        watches.map((w) => (
          <div key={w.listingId} style={{ display: "flex", gap: 12, alignItems: "center", background: "var(--color-background-secondary)", borderRadius: 10, border: "0.5px solid var(--color-border-tertiary)", padding: 12, marginBottom: 8 }}>
            {w.imageUrl && (
              <img src={w.imageUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 6, flexShrink: 0, border: "0.5px solid var(--color-border-tertiary)" }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{[w.brand, w.product].filter(Boolean).join(" ")}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {w.dropped ? (
                  <span style={{ color: "#0F6E56", fontWeight: 500 }}>
                    Down {w.dropPercent}% · {w.currentPriceText}
                    {w.baselinePriceText ? ` (was ${w.baselinePriceText})` : ""}
                  </span>
                ) : (
                  <>Watching since {w.baselinePriceText || "—"} · now {w.currentPriceText || "—"}</>
                )}
                {w.targetPrice != null && <span> · alert below ₹{Number(w.targetPrice).toLocaleString()}</span>}
              </div>
            </div>
            <button
              onClick={() => handleRemove(w.listingId)}
              disabled={removingId === w.listingId}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#D85A30", whiteSpace: "nowrap" }}
            >
              {removingId === w.listingId ? "…" : "Stop watching"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
