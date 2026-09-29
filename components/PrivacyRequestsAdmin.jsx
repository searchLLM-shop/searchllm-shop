"use client";

// Admin queue for DPDP data-principal requests — see schema.sql's
// privacy_requests comment and app/api/admin/privacy-requests/route.js.
// Fulfilment (compiling an export, actually deleting a user's rows) is
// a manual step done directly against the DB, same as every other
// one-off admin action this codebase relies on — this panel just tracks
// and resolves the request record itself.

import { useState, useEffect, useCallback } from "react";

const TYPE_LABEL = { access: "Copy of data", delete: "Delete account" };

export default function PrivacyRequestsAdmin() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/privacy-requests");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setRequests(json.requests || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(id, status) {
    setBusyId(id);
    try {
      await fetch("/api/admin/privacy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;

  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>Privacy requests</h2>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 18 }}>
        DPDP Act data-principal requests. Fulfilling one (an actual export or deletion) is manual — mark it done here once handled.
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Pending ({pending.length})</div>
        {pending.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Nothing pending.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {pending.map((r, i) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.identity}</span>
                <span style={{ color: "var(--color-text-tertiary)" }}>{TYPE_LABEL[r.request_type] || r.request_type}</span>
                <span style={{ color: "var(--color-text-tertiary)" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <a
                    href={`/api/admin/privacy-requests/export?requestId=${r.id}`}
                    style={{ background: "#fff", color: "#0F6E56", border: "1px solid #0F6E56", borderRadius: 6, padding: "4px 10px", fontSize: 11, textDecoration: "none" }}
                  >
                    {r.request_type === "access" ? "Download data" : "Download record"}
                  </a>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => resolve(r.id, "fulfilled")}
                    style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
                  >
                    Mark done
                  </button>
                  <button
                    disabled={busyId === r.id}
                    onClick={() => resolve(r.id, "rejected")}
                    style={{ background: "none", color: "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
                  >
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Resolved</div>
        {resolved.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Nothing resolved yet.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
            {resolved.map((r, i) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.identity}</span>
                <span style={{ color: "var(--color-text-tertiary)" }}>{TYPE_LABEL[r.request_type] || r.request_type}</span>
                <span style={{ color: r.status === "fulfilled" ? "#0F6E56" : "#A03530" }}>{r.status}</span>
                <span style={{ color: "var(--color-text-tertiary)" }}>{r.resolved_at ? new Date(r.resolved_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
