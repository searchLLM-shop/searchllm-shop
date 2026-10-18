"use client";

// Admin moderation list for member testimonials. Approving one puts it on the
// homepage for everyone; "Unpublish" takes it back down.

import { useState, useEffect, useCallback } from "react";

const when = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const STATUS_STYLE = {
  pending: { color: "#854F0B", background: "#FAEEDA", label: "Pending" },
  approved: { color: "#0F6E56", background: "#E1F5EE", label: "Live on homepage" },
  rejected: { color: "#A03530", background: "#FDF3F2", label: "Rejected" },
};
const btn = { padding: "5px 11px", fontSize: 12, borderRadius: 7, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", cursor: "pointer" };

export default function TestimonialsAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/testimonials");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setItems(json.testimonials || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id, action) {
    if (action === "delete" && !confirm("Delete this testimonial permanently?")) return;
    setBusyId(id);
    try {
      const resp = await fetch("/api/admin/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!resp.ok) throw new Error("Action failed");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = items.filter((t) => filter === "all" || t.status === filter);
  const count = (s) => items.filter((t) => t.status === s).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[["all", `All (${items.length})`], ["pending", `Pending (${count("pending")})`], ["approved", `Live (${count("approved")})`], ["rejected", `Rejected (${count("rejected")})`]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ ...btn, fontWeight: filter === k ? 600 : 400, background: filter === k ? "var(--color-background-tertiary)" : btn.background }}>{label}</button>
        ))}
      </div>

      {error && <div style={{ padding: 10, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {loading && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>Loading…</div>}
      {!loading && shown.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>No testimonials here yet.</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {shown.map((t) => {
          const st = STATUS_STYLE[t.status] || STATUS_STYLE.pending;
          return (
            <div key={t.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#E8A317", letterSpacing: 1 }}>{"★".repeat(t.rating)}</span>
                  <span style={{ color: "#D3D1C7", letterSpacing: 1 }}>{"★".repeat(5 - t.rating)}</span>
                  <span style={{ marginLeft: 8, fontWeight: 500 }}>{t.displayName || "A SearchLLM member"}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "var(--color-text-tertiary)" }}>member {t.member} · {when(t.updatedAt)}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 10, color: st.color, background: st.background }}>{st.label}</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>{t.comment}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {t.status !== "approved" && <button style={{ ...btn, background: "#0F6E56", color: "#fff", border: "none" }} disabled={busyId === t.id} onClick={() => act(t.id, "approve")}>Approve — show on homepage</button>}
                {t.status === "approved" && <button style={btn} disabled={busyId === t.id} onClick={() => act(t.id, "unpublish")}>Unpublish</button>}
                {t.status === "pending" && <button style={btn} disabled={busyId === t.id} onClick={() => act(t.id, "reject")}>Reject</button>}
                <button style={{ ...btn, color: "#A03530" }} disabled={busyId === t.id} onClick={() => act(t.id, "delete")}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
