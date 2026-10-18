"use client";

// Approved member testimonials on the homepage. Renders nothing until at least
// one has been approved, so there is never an empty "What members say" box.
// Text is shown as plain text (React escapes it) — never as HTML.

import { useState, useEffect } from "react";

function Stars({ n }) {
  return (
    <span aria-label={`${n} out of 5 stars`} style={{ color: "#E8A317", letterSpacing: 1, fontSize: 14 }}>
      {"★".repeat(n)}<span style={{ color: "#D3D1C7" }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function TestimonialsStrip() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetch("/api/testimonials")
      .then((r) => (r.ok ? r.json() : { testimonials: [] }))
      .then((d) => setItems(d.testimonials || []))
      .catch(() => {});
  }, []);
  if (!items.length) return null;

  return (
    <section aria-label="What members say" style={{ padding: "20px 24px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>What members say</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {items.map((t) => (
          <figure key={t.id} style={{ margin: 0, padding: "12px 14px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
            <Stars n={t.rating} />
            <blockquote style={{ margin: "6px 0 8px", fontSize: 13, lineHeight: 1.55 }}>&ldquo;{t.comment}&rdquo;</blockquote>
            <figcaption style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>— {t.displayName || "A SearchLLM member"}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
