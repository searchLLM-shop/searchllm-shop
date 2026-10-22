"use client";

// "Need it fast?" — links to each quick-commerce app's own search for the
// product type, shown only for everyday categories those apps stock. These are
// plain search links: not affiliate links, no price or stock claim (both depend
// on the shopper's location, which only the app knows). Shown once per answer
// so the report can compare impressions with clicks.

import { useEffect } from "react";
import { trackEvent } from "@/lib/track";

export default function QuickCommerceRow({ quickCommerce, resultKey }) {
  const term = quickCommerce?.term;
  const platforms = quickCommerce?.platforms || [];

  useEffect(() => {
    if (!term || !platforms.length) return;
    trackEvent("qc_shown", { platforms: platforms.length });
    // Server-side impression, used by the admin Reports (clicks / shown).
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "qc_shown" }),
      keepalive: true,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, term]);

  if (!term || !platforms.length) return null;

  return (
    <div style={{ margin: "0 0 14px", padding: "10px 14px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, background: "var(--color-background-secondary)" }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>⚡ Need it fast? Check &ldquo;{term}&rdquo; on a quick-delivery app</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {platforms.map((p) => (
          <a
            key={p.id}
            href={`/qc?p=${encodeURIComponent(p.id)}&q=${encodeURIComponent(term)}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => trackEvent("qc_click", { platform: p.id })}
            style={{ fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", color: "inherit", textDecoration: "none", background: "var(--color-background-primary)" }}
          >
            {p.name} →
          </a>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 7, lineHeight: 1.5 }}>
        Plain search links to each app&apos;s own site — we earn nothing from them. Availability, price and delivery time depend on your location; check them in the app.
      </div>
    </div>
  );
}
