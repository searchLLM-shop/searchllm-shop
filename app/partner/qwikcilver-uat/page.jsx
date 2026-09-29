"use client";

// app/partner/qwikcilver-uat/page.jsx
//
// A browser UI on top of the existing token-gated /api/partner/
// qwikcilver-uat route (added earlier for Qwikcilver's UAT round-1
// "provide a test environment" request). Qwikcilver's team asked for an
// actual page rather than raw curl/API calls, so this wraps the same
// endpoint in simple forms — no new backend logic, this file only calls
// what already exists. No Clerk auth (Qwikcilver has no account on the
// platform) — gated purely by the shared partner token, entered once
// and kept in sessionStorage (cleared when the tab closes, never sent
// anywhere but our own API).

import { useEffect, useState } from "react";

const API_BASE = "/api/partner/qwikcilver-uat";
const TEST_SKU_KEYS = [
  "CNPIN",
  "VOUCHER_CODE",
  "UBE_FLOW",
  "CLAIM_CODE",
  "PROCESSING_STATUS",
  "DISABLED",
  "TIMEOUT_FAILURE",
  "TIMEOUT_SUCCESS",
];

const styles = {
  page: { maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif", color: "#111" },
  h1: { fontSize: 22, marginBottom: 4 },
  sub: { color: "#6B7280", fontSize: 13, marginBottom: 24 },
  card: { border: "1px solid #E5E7EB", borderRadius: 10, padding: 18, marginBottom: 18, background: "#fff" },
  cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 12 },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 160 },
  label: { fontSize: 11, color: "#6B7280", fontWeight: 500 },
  input: { padding: "8px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #D1D5DB", outline: "none" },
  select: { padding: "8px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #D1D5DB", outline: "none", background: "#fff" },
  button: { background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "9px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" },
  buttonSecondary: { background: "#fff", color: "#0F6E56", border: "1px solid #0F6E56", borderRadius: 6, padding: "9px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" },
  pre: { background: "#0B1020", color: "#D1FAE5", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 420, overflowY: "auto" },
  errorText: { color: "#B91C1C", fontSize: 13 },
};

function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </div>
  );
}

function ResultPanel({ label, loading, result }) {
  if (!loading && !result) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>{label}</div>
      <pre style={styles.pre}>{loading ? "Loading…" : JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}

export default function QwikcilverUatConsole() {
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [checkingToken, setCheckingToken] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("qc_partner_token");
    if (saved) {
      setToken(saved);
      setUnlocked(true);
    }
  }, []);

  async function call(qs, opts = {}) {
    const resp = await fetch(qs.startsWith("/") ? qs : `${API_BASE}${qs}`, {
      ...opts,
      headers: { "x-partner-token": token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const body = await resp.json().catch(() => null);
    return { http: resp.status, body };
  }

  async function unlock(e) {
    e.preventDefault();
    setCheckingToken(true);
    setTokenError(null);
    try {
      const res = await call(API_BASE);
      if (res.http === 403 || res.http === 503) {
        setTokenError(res.body?.error === "Forbidden" ? "Incorrect token." : "This console isn't active right now.");
        return;
      }
      sessionStorage.setItem("qc_partner_token", token);
      setUnlocked(true);
    } catch (err) {
      setTokenError("Could not reach the API — try again.");
    } finally {
      setCheckingToken(false);
    }
  }

  if (!unlocked) {
    return (
      <div style={styles.page}>
        <h1 style={styles.h1}>Qwikcilver UAT Testing Console</h1>
        <p style={styles.sub}>searchllm.shop's sandbox Qwikcilver integration — enter the access token shared with you.</p>
        <form onSubmit={unlock} style={{ ...styles.card, maxWidth: 420 }}>
          <Field label="Access token">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={styles.input}
              autoFocus
              required
            />
          </Field>
          <div style={{ marginTop: 12 }}>
            <button type="submit" style={styles.button} disabled={checkingToken}>
              {checkingToken ? "Checking…" : "Unlock"}
            </button>
          </div>
          {tokenError && <div style={{ ...styles.errorText, marginTop: 10 }}>{tokenError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Qwikcilver UAT Testing Console</h1>
      <p style={styles.sub}>
        Every action here hits our live sandbox integration directly — real Order/Order Status/Activated Cards/Catalog
        API calls, scoped to Qwikcilver's own TEST_SKUS products only.{" "}
        <button
          type="button"
          onClick={() => { sessionStorage.removeItem("qc_partner_token"); setUnlocked(false); }}
          style={{ background: "none", border: "none", color: "#0F6E56", textDecoration: "underline", cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          Lock
        </button>
      </p>

      <PlaceOrderCard call={call} />
      <OrderStatusCard call={call} />
      <ActivatedCardsCard call={call} />
      <CatalogCard call={call} />
    </div>
  );
}

function PlaceOrderCard({ call }) {
  const [testSkuKey, setTestSkuKey] = useState(TEST_SKU_KEYS[0]);
  const [denomination, setDenomination] = useState(1000);
  const [qty, setQty] = useState(1);
  const [refno, setRefno] = useState("");
  const [telephone, setTelephone] = useState("");
  const [paymentCode, setPaymentCode] = useState("svc");
  const [corruptToken, setCorruptToken] = useState(false);
  const [corruptSignature, setCorruptSignature] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const custom = {
      testSkuKey,
      denomination: Number(denomination) || 1000,
      qty: Number(qty) || 1,
      paymentCode: paymentCode || "svc",
    };
    if (refno) custom.refno = refno;
    if (telephone) custom.telephone = telephone;
    if (corruptToken) custom.corruptToken = true;
    if (corruptSignature) custom.corruptSignature = true;
    try {
      const res = await call(API_BASE, { method: "POST", body: JSON.stringify({ custom }) });
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <div style={styles.cardTitle}>Place a test order</div>
      <div style={styles.row}>
        <Field label="Test SKU">
          <select value={testSkuKey} onChange={(e) => setTestSkuKey(e.target.value)} style={styles.select}>
            {TEST_SKU_KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Denomination (₹)">
          <input type="number" value={denomination} onChange={(e) => setDenomination(e.target.value)} style={styles.input} />
        </Field>
        <Field label="Quantity">
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={styles.input} />
        </Field>
        <Field label="Payment code">
          <input value={paymentCode} onChange={(e) => setPaymentCode(e.target.value)} style={styles.input} />
        </Field>
      </div>
      <div style={styles.row}>
        <Field label="Refno (optional — for duplicate-refno testing)">
          <input value={refno} onChange={(e) => setRefno(e.target.value)} style={styles.input} />
        </Field>
        <Field label="Telephone override (optional)">
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} style={styles.input} placeholder="+91..." />
        </Field>
      </div>
      <div style={{ ...styles.row, marginBottom: 4 }}>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={corruptToken} onChange={(e) => setCorruptToken(e.target.checked)} />
          Corrupt token (auth-failure test)
        </label>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={corruptSignature} onChange={(e) => setCorruptSignature(e.target.checked)} />
          Corrupt signature (auth-failure test)
        </label>
      </div>
      <button type="submit" style={styles.button} disabled={loading}>{loading ? "Placing…" : "Place order"}</button>
      <ResultPanel label="POST /v3/orders" loading={loading} result={result} />
    </form>
  );
}

function OrderStatusCard({ call }) {
  const [refno, setRefno] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await call(`${API_BASE}?orderStatus=${encodeURIComponent(refno)}`);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <div style={styles.cardTitle}>Order Status API</div>
      <div style={styles.row}>
        <Field label="Refno">
          <input value={refno} onChange={(e) => setRefno(e.target.value)} style={styles.input} required />
        </Field>
        <button type="submit" style={styles.buttonSecondary} disabled={loading}>{loading ? "Checking…" : "Check status"}</button>
      </div>
      <ResultPanel label="GET /v3/order/{refno}/status" loading={loading} result={result} />
    </form>
  );
}

function ActivatedCardsCard({ call }) {
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await call(`${API_BASE}?activatedCards=${encodeURIComponent(orderId)}`);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <div style={styles.cardTitle}>Activated Cards API</div>
      <div style={styles.row}>
        <Field label="Order ID">
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} style={styles.input} required />
        </Field>
        <button type="submit" style={styles.buttonSecondary} disabled={loading}>{loading ? "Fetching…" : "Fetch cards"}</button>
      </div>
      <ResultPanel label="GET /v3/order/{orderId}/cards/" loading={loading} result={result} />
    </form>
  );
}

function CatalogCard({ call }) {
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function lookupSku(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await call(`${API_BASE}?sku=${encodeURIComponent(sku)}`);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  async function lookupCategory(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await call(category ? `${API_BASE}?category=${encodeURIComponent(category)}` : API_BASE);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>Catalog / Product API</div>
      <div style={styles.row}>
        <Field label="SKU">
          <input value={sku} onChange={(e) => setSku(e.target.value)} style={styles.input} placeholder="e.g. CNPIN" />
        </Field>
        <button type="button" onClick={lookupSku} style={styles.buttonSecondary} disabled={loading || !sku}>Look up product</button>
      </div>
      <div style={styles.row}>
        <Field label="Category ID (blank = root category list)">
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={styles.input} />
        </Field>
        <button type="button" onClick={lookupCategory} style={styles.buttonSecondary} disabled={loading}>Browse category</button>
      </div>
      <ResultPanel label="GET /v3/catalog/..." loading={loading} result={result} />
    </div>
  );
}
