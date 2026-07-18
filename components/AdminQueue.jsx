"use client";

import { useState, useEffect, useCallback } from "react";

// Catches the most common review mistake: approving a listing whose
// tracking link is still a copy-pasted placeholder (e.g. from documentation
// or an unfinished network setup) rather than a real, working link.
function looksLikePlaceholderLink(link) {
  if (!link) return true;
  return /YOUR_ID|0000|example\.com|\.\.\.|replace[_-]?me/i.test(link);
}

export default function AdminQueue() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [syncRuns, setSyncRuns] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState(null);

  // Regenerate keywords with AI. Feed/campaign titles alone produce keywords
  // no shopper would type ("trunativ", "ecommerce"), so listings never match
  // real queries. This rewrites them into actual shopper language.
  async function enrichKeywords() {
    setEnriching(true);
    setEnrichMsg(null);
    setErrorMsg(null);
    try {
      const resp = await fetch("/api/admin/enrich-keywords", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || data.error || "Failed");
      setEnrichMsg(
        data.updated > 0
          ? `Updated keywords for ${data.updated} of ${data.considered} listings.`
          : data.message || "No listings needed keywords."
      );
      await load();
    } catch (e) {
      setErrorMsg("Keyword generation failed: " + e.message);
    } finally {
      setEnriching(false);
    }
  }

  async function bulkAct(status) {
    const verb = status === "approved" ? "approve" : "reject";
    if (!window.confirm(`This will ${verb} ALL ${pending.length} pending listings at once. Continue?`)) return;
    setBulkBusy(true);
    try {
      const resp = await fetch("/api/admin/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error("Bulk action failed");
      await load();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/listings");
      if (resp.status === 403) {
        setErrorMsg("You don't have admin access.");
        setPending([]);
        return;
      }
      if (!resp.ok) throw new Error("Failed to load review queue");
      const data = await resp.json();
      setPending(data.pending || []);
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/sync");
      if (resp.ok) {
        const data = await resp.json();
        setSyncRuns(data.latest || []);
      }
    } catch (e) {
      console.error("Failed to load sync status", e);
    }
  }, []);

  useEffect(() => {
    load();
    loadSyncStatus();
  }, [load, loadSyncStatus]);

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    setErrorMsg(null);

    // The sync can run longer than the browser will hold a fetch open,
    // producing a "Failed to fetch" even when the server is working fine.
    // So we fire the request but don't depend on its response: we also
    // poll the queue + sync-status a few times to reflect the real result.
    const syncCall = fetch("/api/admin/sync", { method: "POST" })
      .then(async (resp) => {
        try {
          const data = await resp.json();
          if (data.results) {
            const failed = data.results.find((r) => r.status === "error");
            if (failed) setErrorMsg(failed.error || `${failed.network} sync failed`);
            setSyncResult(data.results);
          }
        } catch { /* response not JSON / connection dropped — polling covers it */ }
      })
      .catch(() => { /* browser gave up waiting — polling covers it */ });

    // Poll the queue for up to ~90s so newly-imported products show up even
    // if the original request never returns to the browser.
    const started = Date.now();
    const poll = async () => {
      await loadSyncStatus();
      await load();
      if (Date.now() - started < 90000) {
        setTimeout(poll, 6000);
      } else {
        setSyncing(false);
      }
    };

    // Kick off polling shortly after starting, and stop spinning once the
    // request settles OR the poll window ends.
    setTimeout(poll, 5000);
    syncCall.finally(async () => {
      await loadSyncStatus();
      await load();
      setSyncing(false);
    });
  }

  async function act(id, status) {
    try {
      const resp = await fetch("/api/admin/listings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!resp.ok) throw new Error("Action failed");
      setPending((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 14px" }}>Review queue</h2>

      <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: 16, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Product feed sync</span>
          <button
            onClick={enrichKeywords}
            disabled={enriching}
            title="Use AI to generate search keywords shoppers actually type"
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)", borderRadius: 7, padding: "5px 12px", cursor: enriching ? "default" : "pointer", fontSize: 12, marginRight: 8, opacity: enriching ? 0.6 : 1 }}
          >
            {enriching ? "Generating…" : "Fix keywords with AI"}
          </button>
          <button onClick={triggerSync} disabled={syncing} style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", cursor: syncing ? "default" : "pointer", fontSize: 12, fontWeight: 500, opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {syncRuns.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No sync has run yet. Runs automatically every 6 hours, or trigger one manually.</div>
        ) : (
          syncRuns.map((r) => (
            <div key={r.network} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", color: r.status === "error" ? "#D85A30" : "var(--color-text-secondary)" }}>
              <span>{r.network}</span>
              <span>
                {r.status === "error"
                  ? `Error: ${r.errorMessage}`
                  : `${r.productsSeen} seen · ${r.newListings} new · ${r.updatedListings} updated`}
                {r.finishedAt && ` · ${new Date(r.finishedAt).toLocaleString()}`}
              </span>
            </div>
          ))
        )}
        {syncResult && (
          <div style={{ fontSize: 11, color: "#0F6E56", marginTop: 8 }}>Sync complete — queue refreshed below.</div>
        )}
      </div>

      {errorMsg && (
        <div style={{ background: "#D85A3011", border: "1px solid #D85A3044", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#D85A30" }}>
          {errorMsg}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 24, color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>}

      {!loading && pending.length === 0 && !errorMsg && (
        <div style={{ textAlign: "center", padding: 24, color: "var(--color-text-tertiary)", fontSize: 13 }}>No pending submissions.</div>
      )}

      {enrichMsg && (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{enrichMsg}</div>
      )}

      {!loading && pending.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "var(--color-background-tertiary)", borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{pending.length} pending</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => bulkAct("approved")}
            disabled={bulkBusy}
            style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 7, padding: "6px 14px", cursor: bulkBusy ? "default" : "pointer", fontSize: 12, fontWeight: 500, opacity: bulkBusy ? 0.6 : 1 }}
          >
            {bulkBusy ? "Working…" : "Approve all pending"}
          </button>
          <button
            onClick={() => bulkAct("rejected")}
            disabled={bulkBusy}
            style={{ background: "none", border: "0.5px solid #E24B4A", color: "#E24B4A", borderRadius: 7, padding: "6px 14px", cursor: bulkBusy ? "default" : "pointer", fontSize: 12 }}
          >
            Reject all pending
          </button>
        </div>
      )}

      {pending.map((l) => (
        <div key={l.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{l.product} — {l.price}</div>
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500, textTransform: "uppercase", background: l.source === "feed" ? "#185FA522" : "#85878022", color: l.source === "feed" ? "#185FA5" : "var(--color-text-secondary)" }}>
              {l.source === "feed" ? "from feed" : "manual"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{l.brand} · tracked via {l.network}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 4, wordBreak: "break-all" }}>{l.networkLink}</div>
          {looksLikePlaceholderLink(l.networkLink) && (
            <div style={{ fontSize: 11, color: "#854F0B", background: "#BA751722", borderRadius: 6, padding: "5px 9px", marginBottom: 8 }}>
              This link looks like a placeholder (contains &quot;YOUR_ID&quot; or similar) — confirm it&apos;s a real tracking link from {l.network} before approving.
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{l.pitch}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => act(l.id, "approved")} style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>Approve</button>
            <button onClick={() => act(l.id, "rejected")} style={{ background: "none", border: "0.5px solid #E24B4A", color: "#E24B4A", borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>Reject</button>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 16 }}>
        Click and sale performance lives in your Awin, Impact, and vCommission publisher dashboards, not here.
      </div>
    </div>
  );
}
