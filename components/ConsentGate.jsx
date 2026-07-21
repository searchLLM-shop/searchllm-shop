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

export default function ConsentGate({onAccept, locale = "en" }) {
  const tr = t(locale);
  const [modal, setModal] = useState(null);
  const [privacyRead, setPrivacyRead] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);

  return (
    <div style={{ position: "relative", minHeight: 560 }}>
      {modal && <Modal title={modal.title} content={modal.content} onClose={() => { if (modal.key === "privacy") setPrivacyRead(true); else setTermsRead(true); setModal(null); }} />}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "44px 24px 32px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>SearchLLM</div>
        <h1 style={{ fontSize: 24, fontWeight: 500, margin: "0 0 10px", lineHeight: 1.3 }}>{tr("tagline1")}<br />{tr("tagline2")}<br />{tr("tagline3")}</h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          One honest pick, the alternatives we didn&apos;t choose, and why — for every shopping question.
        </p>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: 20, textAlign: "left", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 14px", lineHeight: 1.6 }}>
            {tr("beforeStart")}
          </p>
          <button onClick={() => setModal({ title: "Privacy Policy", content: PRIVACY_POLICY, key: "privacy" })} style={{ background: "none", border: `1px solid ${privacyRead ? "#0F6E56" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "9px 14px", cursor: "pointer", color: privacyRead ? "#0F6E56" : "var(--color-text-primary)", fontSize: 13, width: "100%", textAlign: "left", marginBottom: 8 }}>
            {privacyRead ? "✓ " : "→ "}Privacy Policy {!privacyRead && "(read first)"}
          </button>
          <button onClick={() => setModal({ title: "Terms of Use", content: TERMS, key: "terms" })} style={{ background: "none", border: `1px solid ${termsRead ? "#0F6E56" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "9px 14px", cursor: "pointer", color: termsRead ? "#0F6E56" : "var(--color-text-primary)", fontSize: 13, width: "100%", textAlign: "left", marginBottom: 14 }}>
            {termsRead ? "✓ " : "→ "}Terms of Use, including our honesty commitment {!termsRead && "(read first)"}
          </button>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={c1} onChange={e => setC1(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{tr("acceptPrivacy")}</span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={c2} onChange={e => setC2(e.target.checked)} style={{ marginTop: 2 }} />
            <span>{tr("acceptTerms")}</span>
          </label>
        </div>
        <button onClick={onAccept} disabled={!c1 || !c2} style={{ width: "100%", padding: 13, background: c1 && c2 ? "#0F6E56" : "var(--color-background-secondary)", color: c1 && c2 ? "#fff" : "var(--color-text-tertiary)", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: c1 && c2 ? "pointer" : "not-allowed" }}>
          {tr("startResearching")}
        </button>
      </div>
    </div>
  );
}
