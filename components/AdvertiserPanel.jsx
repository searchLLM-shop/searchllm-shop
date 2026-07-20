"use client";

import { useState, useEffect, useCallback } from "react";

const input = {
  width: "100%", padding: "8px 10px", fontSize: 13, borderRadius: 8,
  border: "0.5px solid var(--color-border-secondary)",
  background: "var(--color-background-primary)", color: "var(--color-text-primary)",
  boxSizing: "border-box", marginBottom: 10,
};
const label = { fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 };

function Copyable({ value, mono = true }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <code style={{ flex: 1, fontSize: 11, fontFamily: mono ? "monospace" : "inherit", background: "var(--color-background-tertiary)", padding: "6px 8px", borderRadius: 6, overflowX: "auto", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
        {value}
      </code>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: copied ? "#0F6E56" : "var(--color-text-secondary)", whiteSpace: "nowrap" }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function AdvertiserPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ productName: "", destinationUrl: "", price: "", category: "", imageUrl: "", description: "" });
  const [saving, setSaving] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://searchllm.shop";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/advertiser/products");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Could not load");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addProduct() {
    setSaving(true);
    try {
      const resp = await fetch("/api/advertiser/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Could not add product");
      setForm({ productName: "", destinationUrl: "", price: "", category: "", imageUrl: "", description: "" });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>Loading…</div>;
  if (error && !data) return <div style={{ padding: 14, background: "#FDF3F2", borderRadius: 8, fontSize: 12, color: "#A03530" }}>{error}</div>;
  if (!data) return null;

  const { advertiser: a, products, stats } = data;
  const postbackUrl = `${origin}/api/track/conversion?click_id={CLICK_ID}&order_id={ORDER_ID}&value={ORDER_VALUE}&secret=${a.postbackSecret}`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>{a.companyName}</h2>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: a.status === "approved" ? "#0F6E5622" : "#BA751733", color: a.status === "approved" ? "#0F6E56" : "#854F0B" }}>
          {a.status}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 18 }}>
        {a.commissionModel === "cps" ? `${a.commissionRate}% of sale value` : `${a.currency} ${a.commissionRate} per sale`}
        {" · "}{a.cookieDays}-day attribution window
      </div>

      {a.status !== "approved" && (
        <div style={{ background: "#BA75171A", border: "0.5px solid #BA751744", borderRadius: 10, padding: 14, fontSize: 12, color: "#854F0B", marginBottom: 18 }}>
          Your account is under review. You can set up tracking now, but products won&apos;t appear to shoppers until we approve the account.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>
        {[
          ["Clicks", stats.clicks],
          ["Sales", stats.conversions],
          [`Sales value (${a.currency})`, Number(stats.sales_value || 0).toLocaleString()],
          ["Commission due", `${a.currency} ${Number(stats.commission_due || 0).toLocaleString()}`],
          ["Commission paid", `${a.currency} ${Number(stats.commission_paid || 0).toLocaleString()}`],
        ].map(([k, v]) => (
          <div key={k} style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4 }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* The integration step everything depends on. Without this, clicks are
          recorded but sales aren't, so nothing can be billed accurately. */}
      <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Step 1 — Install the conversion postback</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
          When a shopper arrives from one of your tracking links, we append <code style={{ fontSize: 11 }}>click_id</code> to the URL.
          Store it (a cookie or your session works fine), and when the order completes, call this URL from your
          order-confirmation page or server, substituting the three placeholders.
          <strong> Until this is live we can record clicks but not sales, so nothing can be billed.</strong>
        </div>
        <Copyable value={postbackUrl} />
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8, lineHeight: 1.6 }}>
          Keep the secret private — it&apos;s what proves a sale came from you. Duplicate <code>order_id</code> values are
          ignored, so retries are safe. Clicks older than {a.cookieDays} days fall outside the attribution window.
        </div>
      </div>

      <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Step 2 — Add a product</div>
        <label style={label}>Product name *</label>
        <input style={input} value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="Merino Wool Running Socks" />
        <label style={label}>Destination URL * — the exact product page</label>
        <input style={input} value={form.destinationUrl} onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })} placeholder="https://yourstore.com/products/merino-socks" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={label}>Price</label><input style={input} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="₹1,299" /></div>
          <div><label style={label}>Category</label><input style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="fashion" /></div>
        </div>
        <label style={label}>Image URL</label>
        <input style={input} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://yourstore.com/images/socks.jpg" />
        <label style={label}>Short description — what makes it genuinely good, not marketing copy</label>
        <input style={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="70% merino, flat-toe seam, holds shape after 50 washes" />
        {error && <div style={{ fontSize: 12, color: "#A03530", marginBottom: 8 }}>{error}</div>}
        <button onClick={addProduct} disabled={saving || !form.productName || !form.destinationUrl}
          style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Adding…" : "Add product"}
        </button>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
          Every product goes through the same human review as everything else on the platform, and a paid placement is
          always labelled as sponsored. Payment does not buy a recommendation — if your product isn&apos;t the right answer
          to a shopper&apos;s question, we won&apos;t say that it is.
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Your products and tracking links</div>
      {products.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>No products yet.</div>
      ) : (
        products.map((p) => (
          <div key={p.id} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{p.product_name}</span>
              <span style={{ fontSize: 11, color: p.status === "approved" ? "#0F6E56" : "var(--color-text-tertiary)" }}>{p.status}</span>
            </div>
            <Copyable value={`${origin}/go/${p.tracking_id}`} />
          </div>
        ))
      )}
    </div>
  );
}
