"use client";

import { useState, useEffect, useCallback } from "react";

export default function AnswersAdmin() {
  const [answers, setAnswers] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/admin/answers");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed");
      setAnswers(json.answers || []);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setBusy(id);
    try {
      await fetch("/api/admin/answers", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally { setBusy(null); }
  }

  async function publishAll() {
    const drafts = answers.filter((a) => a.status === "draft").length;
    if (!window.confirm(`Publish all ${drafts} draft answers? They'll become public, indexable pages.`)) return;
    setBusy("all");
    try {
      await fetch("/api/admin/answers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish_all" }),
      });
      await load();
    } finally { setBusy(null); }
  }

  const drafts = answers.filter((a) => a.status === "draft").length;
  const published = answers.filter((a) => a.status === "published").length;

  if (error) return <div style={{ fontSize: 12, color: "#A03530" }}>{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Answer pages</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{published} live · {drafts} draft</span>
          {drafts > 0 && (
            <button onClick={publishAll} disabled={busy === "all"}
              style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
              {busy === "all" ? "Publishing…" : `Publish all ${drafts}`}
            </button>
          )}
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "0 0 14px", lineHeight: 1.6 }}>
        Each researched question becomes a draft page. Review before publishing — these are public and indexable,
        and thin or wrong pages hurt the whole site&apos;s standing in search.
      </p>

      {answers.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>
          No answer pages yet. They&apos;re created automatically as people search.
        </div>
      ) : (
        answers.map((a) => (
          <div key={a.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 12, marginBottom: 8, background: a.status === "draft" ? "var(--color-background-secondary)" : "transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{a.topic || a.headline}</span>
              <span style={{ fontSize: 10, color: a.status === "published" ? "#0F6E56" : "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{a.status}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
              /answers/{a.slug}
              {a.country ? ` · ${a.country}` : ""}
              {a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString()}` : ""}
            </div>

            {expanded === a.id && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10, paddingTop: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>{a.headline}</div>
                <div style={{ marginBottom: 8 }}>{a.body}</div>
                {a.who_for && (
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Good for:</strong> {a.who_for}
                  </div>
                )}
                {a.who_skip && (
                  <div style={{ marginBottom: 8 }}>
                    <strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Skip if:</strong> {a.who_skip}
                  </div>
                )}
                {Array.isArray(a.alternatives) && a.alternatives.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 4 }}>
                      Alternatives shown (no affiliate links)
                    </div>
                    {a.alternatives.map((alt, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
                        <span>{alt.name}{alt.note ? <span style={{ color: "var(--color-text-tertiary)" }}> — {alt.note}</span> : null}</span>
                        <span style={{ whiteSpace: "nowrap", color: "var(--color-text-tertiary)" }}>{alt.price}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                {expanded === a.id ? "Hide" : "Preview"}
              </button>
              {a.status !== "published" && (
                <button onClick={() => setStatus(a.id, "published")} disabled={busy === a.id}
                  style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "3px 12px", fontSize: 11, cursor: "pointer" }}>Publish</button>
              )}
              {a.status === "published" && (
                <>
                  <a href={`/answers/${a.slug}`} target="_blank" rel="noreferrer"
                    style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--color-text-secondary)", textDecoration: "none" }}>View</a>
                  <button onClick={() => setStatus(a.id, "draft")} disabled={busy === a.id}
                    style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}>Unpublish</button>
                </>
              )}
              {a.status !== "rejected" && (
                <button onClick={() => setStatus(a.id, "rejected")} disabled={busy === a.id}
                  style={{ background: "none", border: "0.5px solid #E24B4A", color: "#E24B4A", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Reject</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
