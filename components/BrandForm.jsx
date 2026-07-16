"use client";

import { useState } from "react";

export default function BrandForm() {
  const [form, setForm] = useState({ brand: "", product: "", price: "", category: "outdoor", keywords: "", network: "Awin", networkLink: "", pitch: "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleSubmit() {
    if (!form.brand || !form.product || !form.networkLink) {
      setErrorMsg("Brand name, product name, and tracking link are required.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
      setSubmitted(true);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>List your product</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
          We only recommend products we&apos;d genuinely pick. Submit yours for review — if it&apos;s a real fit for real questions, it gets shown, always labeled as sponsored, alongside the alternatives we didn&apos;t choose.
        </p>
      </div>

      <div style={{ background: "var(--color-background-tertiary)", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        We track affiliate links through Awin, Impact, or vCommission rather than building our own tracking. Global brands typically use Awin or Impact; Indian D2C brands, especially those relying on cash-on-delivery, are usually better served by vCommission. If your brand already runs a program on one of these, approve SearchLLM as a partner inside your own dashboard and generate a tracking link for us — paste that link below.
      </div>

      {submitted ? (
        <div style={{ background: "#0F6E5611", border: "1px solid #0F6E5644", borderRadius: 12, padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#0F6E56", marginBottom: 6 }}>Submitted for review</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>We review every listing before it goes live. You&apos;ll hear back either way.</div>
          <button
            onClick={() => { setSubmitted(false); setForm({ brand: "", product: "", price: "", category: "outdoor", keywords: "", network: "Awin", networkLink: "", pitch: "" }); }}
            style={{ marginTop: 14, background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            Submit another
          </button>
        </div>
      ) : (
        <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: 20 }}>
          {errorMsg && (
            <div style={{ background: "#D85A3011", border: "1px solid #D85A3044", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#D85A30" }}>
              {errorMsg}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Brand name</label>
              <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Price</label>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="$129" style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Product name</label>
            <input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Honest one-line pitch</label>
            <input value={form.pitch} onChange={(e) => setForm({ ...form, pitch: e.target.value })} placeholder="Specific, not marketing-speak" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Keywords (comma-separated)</label>
            <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="hiking, jacket, waterproof" style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Network</label>
            <select value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }}>
              <option value="Awin">Awin</option>
              <option value="Impact">Impact</option>
              <option value="vCommission">vCommission</option>
            </select>
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5 }}>Your tracking link for SearchLLM</label>
            <input value={form.networkLink} onChange={(e) => setForm({ ...form, networkLink: e.target.value })} placeholder="https://www.awin1.com/cread.php?..." style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ background: "#854F0B", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", cursor: submitting ? "default" : "pointer", fontSize: 14, fontWeight: 500, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "Submitting…" : "Submit for review"}
          </button>
        </div>
      )}
    </div>
  );
}
