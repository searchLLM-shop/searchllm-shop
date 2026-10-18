"use client";

// A member's own testimonial: star rating, a short comment and the name they
// want shown. One per member; submitting again replaces it. Nothing is public
// until an admin approves it (see app/api/admin/testimonials).

import { useState, useEffect } from "react";

const STATUS_NOTE = {
  pending: "Thanks — your review is waiting for approval. It will appear on our homepage once approved.",
  approved: "Your review is live on the homepage. Thank you!",
  rejected: "Your last review wasn't published. You're welcome to write a new one.",
};

export default function TestimonialForm() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [existing, setExisting] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: "ok" | "err", text }

  useEffect(() => {
    fetch("/api/testimonials?mine=1")
      .then(async (r) => {
        if (r.status === 401) { setSignedIn(false); return null; }
        return r.json();
      })
      .then((d) => {
        const t = d?.testimonial;
        if (t) {
          setExisting(t);
          setRating(t.rating);
          setComment(t.comment);
          setDisplayName(t.displayName || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const resp = await fetch("/api/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment, displayName, consent }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || "Could not save your review.");
      setExisting({ rating, comment, displayName, status: json.status || "pending" });
      setConsent(false);
      setMessage({ kind: "ok", text: STATUS_NOTE.pending });
    } catch (err) {
      setMessage({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", padding: 16 }}>Loading…</div>;
  if (!signedIn) {
    return <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>Sign in to leave a rating and a short review of SearchLLM.shop.</div>;
  }

  const canSubmit = !busy && rating >= 1 && comment.trim().length >= 10 && consent;

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>How would you rate SearchLLM.shop?</div>
      {existing && STATUS_NOTE[existing.status] && !message && (
        <div style={{ fontSize: 12, color: "#0F6E56", background: "#E1F5EE", borderRadius: 8, padding: "8px 12px" }}>{STATUS_NOTE[existing.status]}</div>
      )}

      <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 28, lineHeight: 1, padding: 2, color: n <= rating ? "#E8A317" : "#D3D1C7" }}
          >
            ★
          </button>
        ))}
      </div>

      <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
        Your review
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="What was useful, or what could be better?"
          style={{ fontSize: 13, padding: 8, borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", resize: "vertical", fontFamily: "inherit" }}
        />
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "right" }}>{comment.length}/500</span>
      </label>

      <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
        Name to show (optional — leave blank to appear as &ldquo;A SearchLLM member&rdquo;)
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          placeholder="e.g. Priya S."
          style={{ fontSize: 13, padding: 8, borderRadius: 8, border: "0.5px solid var(--color-border-secondary)" }}
        />
      </label>

      <label style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I agree that SearchLLM.shop may show my rating, review and the name above publicly on its homepage. I can ask for it to be removed at any time.</span>
      </label>

      {message && (
        <div style={{ fontSize: 12, color: message.kind === "ok" ? "#0F6E56" : "#A03530" }}>{message.text}</div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        style={{ justifySelf: "start", padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#0F6E56", color: "#fff", cursor: canSubmit ? "pointer" : "default", opacity: canSubmit ? 1 : 0.5 }}
      >
        {busy ? "Saving…" : existing ? "Update my review" : "Submit review"}
      </button>
      {existing && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Updating a published review sends it back for approval.</div>}
    </form>
  );
}
