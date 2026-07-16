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
    try {
      const resp = await fetch("/api/admin/sync", { method: "POST" });
      // The sync can take a while and may hit the serverless time limit,
      // in which case Vercel returns an HTML error page, not JSON. Guard
      // against parsing HTML as JSON so the user sees a clear message.
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await resp.text();
        const timedOut = resp.status === 504 || /timeout|FUNCTION_INVOCATION/i.test(text);
        throw new Error(
          timedOut
            ? "Sync took too long and timed out. It may still have imported some products — refresh the queue in a moment. If this keeps happening, we can lower the per-run limit."
            : `Sync failed with status ${resp.status}.`
        );
      }
      const data = await resp.json();
      setSyncResult(data.results || null);
      await loadSyncStatus();
      await load();
    } catch (e) {
      setErrorMsg("Sync failed: " + e.message);
    } finally {
      setSyncing(false);
    }
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
