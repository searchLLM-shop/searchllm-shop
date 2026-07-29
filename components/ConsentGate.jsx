"use client";

import { useState } from "react";
import { PRIVACY_POLICY, TERMS } from "@/lib/constants";
import { t } from "@/lib/i18n";

function Modal({ title, content, onClose }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, padding: 20, overflowY: "auto" }}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: 14, border: "0.5px solid var(--color-border-tertiary)", padding: 24, maxWidth: 560, width: "100%", marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 18, padding: "4px 8px" }}>✕</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, margin: 0, maxHeight: 380, overflowY: "auto" }}>{content}</pre>
        <button onClick={onClose} style={{ marginTop: 16, width: "100%", padding: 10, background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500 }}>I have read and understood</button>
      </div>
    </div>
  );
}

export default function ConsentGate({ onAccept, locale = "en" }) {
  const tr = t(locale);
  const [modal, setModal] = useState(null);
  const [accepted, setAccepted] = useState(false);

  // Standard clickwrap: the policies are one tap away and named in the
  // consent sentence itself, but reading them is no longer a gate. The
  // previous version required opening both documents and ticking two boxes
  // before anything could happen — four actions on a first mobile visit,
  // which is a large share of paid traffic lost before the product is ever
  // seen. The disclosure is unchanged; only the ceremony is lighter.
  const PolicyLink = ({ label, title, content, key: k }) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setModal({ title, content });
      }}
      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#0F6E56", textDecoration: "underline", cursor: "pointer" }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: "relative", minHeight: 560 }}>
      {modal && <Modal title={modal.title} content={modal.content} onClose={() => setModal(null)} />}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "44px 24px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>SearchLLM</div>
        <h1 style={{ fontSize: 24, fontWeight: 500, margin: "0 0 10px", lineHeight: 1.3 }}>
          {tr("tagline1")}<br />{tr("tagline2")}<br />{tr("tagline3")}
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginBottom: 26, lineHeight: 1.6 }}>
          {tr("subtitle")}
        </p>

        <div
          onClick={() => setAccepted((v) => !v)}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6, cursor: "pointer", marginBottom: 18 }}
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 3 }}
          />
          <span>
            {tr("acceptBothPre")}
            <PolicyLink label={tr("privacyLabel")} title="Privacy Policy" content={PRIVACY_POLICY} />
            {tr("acceptBothMid")}
            <PolicyLink label={tr("termsLabel")} title="Terms of Use" content={TERMS} />
            {tr("acceptBothPost")}
          </span>
        </div>

        <button
          onClick={onAccept}
          disabled={!accepted}
          style={{ width: "100%", padding: 13, background: accepted ? "#0F6E56" : "var(--color-background-secondary)", color: accepted ? "#fff" : "var(--color-text-tertiary)", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: accepted ? "pointer" : "not-allowed" }}
        >
          {tr("startResearching")}
        </button>
      </div>
    </div>
  );
}
