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
  const [inventory, setInventory] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [autoIssuanceConfigured, setAutoIssuanceConfigured] = useState(false);
  const [autoBusy, setAutoBusy] = useState(null); // redemption id currently attempting auto-issuance
  const [autoErrors, setAutoErrors] = useState({}); // { [redemptionId]: reason }
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState(null);
  const [backfill, setBackfill] = useState({ running: false, processed: 0, remaining: null });
  const [keywordBacklog, setKeywordBacklog] = useState(null);
  const [pendingCounts, setPendingCounts] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Show how many listings still need keywords, so it's obvious whether
  // another run is needed rather than having to guess.
  const loadKeywordBacklog = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/enrich-keywords");
      if (!resp.ok) return;
      setKeywordBacklog(await resp.json());
    } catch { /* non-critical */ }
  }, []);

  // Regenerate keywords with AI. Feed/campaign titles alone produce keywords
  // no shopper would type ("trunativ", "ecommerce"), so listings never match
  // real queries. This rewrites them into actual shopper language.
  // Runs a single batch. Bulk clearing is handled by the hourly cron job
  // instead — a browser loop meant one long fetch per batch, which hit fetch
  // timeouts and required the tab to stay open for an hour.
  async function runEnrichBatch() {
    const resp = await fetch("/api/admin/enrich-keywords", { method: "POST" });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(data?.detail || data?.error || "Keyword generation failed");
    return data;
  }

  async function enrichKeywords() {
    setEnriching(true);
    setErrorMsg(null);
    setEnrichMsg("Generating keywords for the next batch…");
    try {
      const data = await runEnrichBatch();
      await loadKeywordBacklog();
      const remaining = Number(data.remaining || 0);
      setEnrichMsg(
        remaining > 0
          ? `Processed ${data.updated} listings. ${remaining.toLocaleString()} still to go — the hourly job will clear these automatically, or click again.`
          : `Processed ${data.updated} listings. Nothing left to do.`
      );
      await load(page);
    } catch (e) {
      setErrorMsg(`${e.message}. Any completed batches are saved.`);
    } finally {
      setEnriching(false);
    }
  }

  async function bulkAct(status) {
    const verb = status === "approved" ? "approve" : "reject";
    if (!window.confirm(`This will ${verb} ALL ${(pendingCounts?.total ?? pending.length).toLocaleString()} pending listings across every network, not just the ones shown. Continue?`)) return;
    setBulkBusy(true);
    try {
      const resp = await fetch("/api/admin/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error("Bulk action failed");
      await load(page);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const load = useCallback(async (pageIndex = 0) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/listings?limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Could not load queue");
      // The queue is paged; counts describe the WHOLE queue, which is what
      // bulk actions operate on.
      setPending(data.listings || []);
      setPendingCounts(data.counts || null);
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
        setInventory(data.inventory || []);
      }
      const eResp = await fetch("/api/admin/enrich-keywords");
      if (eResp.ok) {
        const eData = await eResp.json();
        if (typeof eData.pending === "number") setBackfill((b) => ({ ...b, remaining: eData.pending }));
      }
      const rResp = await fetch("/api/admin/redemptions");
      if (rResp.ok) {
        const rData = await rResp.json();
        setRedemptions(rData.queue || []);
        setAutoIssuanceConfigured(Boolean(rData.autoIssuanceConfigured));
      }
    } catch (e) {
      console.error("Failed to load sync status", e);
    }
  }, []);

  useEffect(() => {
    load();
    loadSyncStatus();
    loadKeywordBacklog();
  }, [load, loadSyncStatus, loadKeywordBacklog]);

  // Manual conversion poll — same fire-and-poll pattern as triggerSync so a
  // slow network API can't strand the button on "Failed to fetch". The poll
  // is quick (two report reads), so a short status refresh is enough.
  async function triggerConversionPoll() {
    setSyncing(true);
    setErrorMsg(null);
    fetch("/api/admin/conversions", { method: "POST" })
      .then(async (resp) => {
        try {
          const data = await resp.json();
          const failed = (data.results || []).find((r) => r.error);
          if (failed) setErrorMsg(`${failed.network} conversions: ${failed.error}`);
        } catch { /* covered by status refresh */ }
      })
      .catch(() => { /* covered by status refresh */ });
    setTimeout(async () => { await loadSyncStatus(); setSyncing(false); }, 4000);
  }

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
      await load(page);
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
      await load(page);
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
            title="Process the next batch now. The hourly job clears the rest automatically."
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)", borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: enriching ? "default" : "pointer", marginRight: 8, opacity: enriching ? 0.6 : 1 }}
          >
            {enriching
              ? "Working…"
              : keywordBacklog?.pending > 0
              ? `Fix keywords (${keywordBacklog.pending.toLocaleString()} left)`
              : "Fix keywords with AI"}
          </button>
          <button onClick={triggerConversionPoll} disabled={syncing} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 7, padding: "5px 12px", cursor: syncing ? "default" : "pointer", fontSize: 12, color: "var(--color-text-secondary)", opacity: syncing ? 0.6 : 1 }}>
            Poll conversions
          </button>
          <button onClick={triggerSync} disabled={syncing} style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", cursor: syncing ? "default" : "pointer", fontSize: 12, fontWeight: 500, opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {syncRuns.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No sync has run yet. Runs automatically every 6 hours, or trigger one manually.</div>
        ) : (
          syncRuns.map((r) => (
            <div key={r.network} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "4px 0", color: r.status === "error" ? "#D85A30" : "var(--color-text-secondary)" }}>
              <span style={{ whiteSpace: "nowrap" }}>{r.network}</span>
              <span style={{ textAlign: "right" }}>
                {r.status === "error"
                  ? `Error: ${r.errorMessage}`
                  : r.status === "skipped"
                    ? `Skipped — ${r.errorMessage}`
                    : `${Number(r.productsSeen || 0).toLocaleString()} seen · ${Number(r.newListings || 0).toLocaleString()} new · ${Number(r.updatedListings || 0).toLocaleString()} updated`}
                {r.finishedAt && ` · ${new Date(r.finishedAt).toLocaleString()}`}
              </span>
            </div>
          ))
        )}
        {inventory.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 4 }}>
              Total inventory by network
            </div>
            {inventory.map((x) => (
              <div key={x.network} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "3px 0", color: "var(--color-text-secondary)" }}>
                <span style={{ whiteSpace: "nowrap" }}>{x.network}</span>
                <span style={{ textAlign: "right" }}>
                  {Number(x.total).toLocaleString()} total
                  {" · "}
                  <span style={{ color: Number(x.approved) > 0 ? "#0F6E56" : "var(--color-text-tertiary)", fontWeight: 500 }}>{Number(x.approved).toLocaleString()} approved</span>
                  {" · "}{Number(x.pending).toLocaleString()} pending
                  {Number(x.rejected) > 0 ? ` · ${Number(x.rejected).toLocaleString()} rejected` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {redemptions.filter((r) => r.status === "requested").length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#854F0B", marginBottom: 4 }}>
              Voucher redemptions awaiting fulfilment
            </div>
            {redemptions.filter((r) => r.status === "requested").map((r) => (
              <div key={r.id} style={{ padding: "4px 0" }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, rowGap: 6, fontSize: 12, color: "var(--color-text-secondary)" }}>
                  <span>{Number(r.points).toLocaleString()} pts → {r.voucher_type} · {r.user_id.slice(0, 14)}… · {new Date(r.created_at).toLocaleDateString()}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {autoIssuanceConfigured && (
                      <button
                        disabled={autoBusy === r.id}
                        onClick={async () => {
                          setAutoBusy(r.id);
                          setAutoErrors((e) => ({ ...e, [r.id]: undefined }));
                          try {
                            const resp = await fetch("/api/admin/redemptions", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: r.id, action: "auto", voucherType: r.voucher_type, points: r.points }),
                            });
                            const data = await resp.json().catch(() => ({}));
                            if (data.ok) {
                              loadSyncStatus();
                            } else {
                              setAutoErrors((e) => ({ ...e, [r.id]: data.reason || "Automatic issuance failed." }));
                            }
                          } finally {
                            setAutoBusy(null);
                          }
                        }}
                        style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", opacity: autoBusy === r.id ? 0.6 : 1 }}
                      >
                        {autoBusy === r.id ? "Issuing…" : "Try automatic"}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const code = window.prompt(`Voucher code for ${r.points} pts ${r.voucher_type}:`);
                        if (!code) return;
                        await fetch("/api/admin/redemptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "fulfill", voucherCode: code.trim() }) });
                        loadSyncStatus();
                      }}
                      style={{ background: autoIssuanceConfigured ? "none" : "#0F6E56", color: autoIssuanceConfigured ? "var(--color-text-secondary)" : "#fff", border: autoIssuanceConfigured ? "0.5px solid var(--color-border-secondary)" : "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
                    >
                      {autoIssuanceConfigured ? "Fulfil manually" : "Fulfil"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Reject this redemption? Points return to the member.")) return;
                        await fetch("/api/admin/redemptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action: "reject" }) });
                        loadSyncStatus();
                      }}
                      style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}
                    >
                      Reject
                    </button>
                  </span>
                </div>
                {autoErrors[r.id] && (
                  <div style={{ fontSize: 11, color: "#D85A30", marginTop: 2 }}>{autoErrors[r.id]}</div>
                )}
              </div>
            ))}
          </div>
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
        <div style={{ textAlign: "center", padding: 24, color: "var(--color-text-tertiary)", fontSize: 13 }}>
          No pending submissions.
          {pendingCounts?.pausedGerman > 0 && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              ({pendingCounts.pausedGerman.toLocaleString()} German-market listings are held out of review while German support is paused — they return here untouched when it re-enables.)
            </div>
          )}
        </div>
      )}

      {backfill.remaining !== null && (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
          Keyword backfill: {backfill.remaining.toLocaleString()} listings remaining{backfill.processed ? ` · ${backfill.processed.toLocaleString()} processed this session` : ""}
          {backfill.running ? " · running…" : ""}
          <button
            onClick={async () => {
              if (backfill.running) { setBackfill((b) => ({ ...b, running: false })); return; }
              setBackfill((b) => ({ ...b, running: true }));
              let keepGoing = true;
              let sessionProcessed = 0;
              while (keepGoing) {
                try {
                  const resp = await fetch("/api/admin/enrich-keywords", { method: "POST" });
                  const j = await resp.json();
                  sessionProcessed += j.updated || j.processed || 0;
                  const rem = j.remaining ?? null;
                  setBackfill((b) => { keepGoing = b.running && rem > 0; return { ...b, processed: sessionProcessed, remaining: rem }; });
                  if (rem === 0) break;
                } catch { await new Promise((r) => setTimeout(r, 10000)); }
              }
              setBackfill((b) => ({ ...b, running: false }));
            }}
            style={{ marginLeft: 8, background: backfill.running ? "none" : "#0F6E56", color: backfill.running ? "var(--color-text-secondary)" : "#fff", border: backfill.running ? "0.5px solid var(--color-border-secondary)" : "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
          >
            {backfill.running ? "Stop" : "Run backfill from this tab"}
          </button>
        </div>
      )}
      {enrichMsg && (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{enrichMsg}</div>
      )}

      {!loading && (pendingCounts?.total > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "var(--color-background-tertiary)", borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {pendingCounts.total.toLocaleString()} pending
            {pendingCounts.pausedGerman > 0 && (
              <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                {" "}· {pendingCounts.pausedGerman.toLocaleString()} German-market listings held out of review while German support is paused — they return here untouched when it re-enables
              </span>
            )}
            {pendingCounts.total > PAGE_SIZE && (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                {" "}· showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, pendingCounts.total)}
              </span>
            )}
          </span>
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

      {pendingCounts?.total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 12 }}>
          <button
            onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p); }}
            disabled={page === 0 || loading}
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: page === 0 ? "default" : "pointer", color: "var(--color-text-secondary)", opacity: page === 0 ? 0.5 : 1 }}
          >← Previous</button>
          <span style={{ color: "var(--color-text-tertiary)" }}>
            Page {page + 1} of {Math.ceil(pendingCounts.total / PAGE_SIZE).toLocaleString()}
          </span>
          <button
            onClick={() => { const p = page + 1; setPage(p); load(p); }}
            disabled={(page + 1) * PAGE_SIZE >= pendingCounts.total || loading}
            style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}
          >Next →</button>
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
