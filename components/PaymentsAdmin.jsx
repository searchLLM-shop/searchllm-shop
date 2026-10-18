"use client";

// Admin: platform-fee receipts / tax invoices for every member, with a PDF per
// payment, a CSV export, and a check against Razorpay's own records
// (app/api/admin/payments). The point is to answer "who paid, and does
// Razorpay agree?" without opening the Razorpay dashboard row by row.

import { useState, useEffect, useCallback } from "react";

const inr = (paise) => (paise == null ? "—" : `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const istDate = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

const cell = { padding: "7px 10px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" };
const head = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)", background: "var(--color-background-tertiary)", textAlign: "left", whiteSpace: "nowrap" };
const btn = { padding: "6px 12px", fontSize: 12, borderRadius: 7, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", cursor: "pointer" };

function Stat({ label, value }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "8px 14px" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export default function PaymentsAdmin() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (reconcile = false) => {
    reconcile ? setChecking(true) : setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/payments?from=${from}&to=${to}${reconcile ? "&reconcile=1" : ""}`);
      const raw = await resp.text();
      let json;
      try { json = JSON.parse(raw); } catch { throw new Error(`The server didn't return payments (HTTP ${resp.status}).`); }
      if (!resp.ok) throw new Error(json.detail || json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [from, to]);

  useEffect(() => { load(false); }, [load]);

  const rec = data?.reconciliation;
  const csvHref = `/api/admin/payments?from=${from}&to=${to}&format=csv`;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: 12 }}>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ marginLeft: 4 }} /></label>
        <label style={{ fontSize: 12 }}>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ marginLeft: 4 }} /></label>
        <button style={btn} onClick={() => load(false)} disabled={loading}>Refresh</button>
        <button style={{ ...btn, background: "#0F6E56", color: "#fff", border: "none" }} onClick={() => load(true)} disabled={checking || loading}>
          {checking ? "Checking Razorpay…" : "Check against Razorpay"}
        </button>
        <a href={csvHref} style={{ ...btn, textDecoration: "none", color: "inherit" }}>Download CSV</a>
      </div>

      {error && <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>Loading payments…</div>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label="Payments" value={data.totals.count} />
            <Stat label="Total collected" value={inr(data.totals.amountPaise)} />
            <Stat label="Taxable value" value={data.totals.taxablePaise ? inr(data.totals.taxablePaise) : "—"} />
            <Stat label="GST (CGST+SGST+IGST)" value={data.totals.cgstPaise + data.totals.sgstPaise + data.totals.igstPaise ? inr(data.totals.cgstPaise + data.totals.sgstPaise + data.totals.igstPaise) : "—"} />
          </div>

          {data.reconcileError && (
            <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12, marginBottom: 12 }}>
              Couldn&apos;t reach Razorpay: {data.reconcileError}
            </div>
          )}

          {rec && (
            <div style={{ marginBottom: 18, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Razorpay check, {data.range.from} to {data.range.to}</div>
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                Razorpay captured <strong>{rec.razorpayCaptured}</strong> payment{rec.razorpayCaptured === 1 ? "" : "s"} ({inr(rec.razorpayCapturedPaise)});{" "}
                <strong>{rec.matched}</strong> match our documents.
                {rec.missingInOurRecords.length === 0 && rec.notInRazorpay.length === 0 && rec.amountMismatch.length === 0 && (
                  <span style={{ color: "#0F6E56", fontWeight: 600 }}> Everything agrees.</span>
                )}
              </div>

              {rec.missingInOurRecords.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#A03530", marginBottom: 4 }}>
                    In Razorpay but no document here ({rec.missingInOurRecords.length}) — the webhook may not have arrived, so the member may not have been unlocked:
                  </div>
                  {rec.missingInOurRecords.map((p) => (
                    <div key={p.id} style={{ fontSize: 12, padding: "3px 0" }}>
                      <code>{p.id}</code> · {inr(p.amountPaise)} · {istDate(p.createdAt)} · {p.contact || "no mobile"} {p.email ? `· ${p.email}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {rec.notInRazorpay.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#854F0B", marginBottom: 4 }}>
                    Document here but not in Razorpay&apos;s captured payments for this window ({rec.notInRazorpay.length}):
                  </div>
                  {rec.notInRazorpay.map((d) => (
                    <div key={d.id} style={{ fontSize: 12, padding: "3px 0" }}><code>{d.paymentId}</code> · {d.docNumber} · {inr(d.amountPaise)}</div>
                  ))}
                </div>
              )}
              {rec.amountMismatch.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#A03530", marginBottom: 4 }}>Amount differs ({rec.amountMismatch.length}):</div>
                  {rec.amountMismatch.map((m) => (
                    <div key={m.documentId} style={{ fontSize: 12, padding: "3px 0" }}><code>{m.paymentId}</code> · {m.docNumber} · ours {inr(m.ourPaise)} vs Razorpay {inr(m.razorpayPaise)}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.documents.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>No platform-fee payments in this period.</div>
          ) : (
            <div style={{ overflowX: "auto", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={head}>Document</th><th style={head}>Paid (IST)</th><th style={head}>Member</th>
                    <th style={{ ...head, textAlign: "right" }}>Amount</th><th style={{ ...head, textAlign: "right" }}>Taxable</th>
                    <th style={{ ...head, textAlign: "right" }}>GST</th><th style={head}>Razorpay payment</th><th style={head}>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.id}>
                      <td style={cell}>{d.docNumber} <span style={{ color: "var(--color-text-tertiary)" }}>({d.docType === "tax_invoice" ? "tax invoice" : "receipt"})</span></td>
                      <td style={cell}>{istDate(d.paidAt)}</td>
                      <td style={cell}>{d.phone || <span style={{ color: "var(--color-text-tertiary)" }} title={d.userId}>{d.userId.slice(0, 14)}…</span>}</td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{inr(d.amountPaise)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{inr(d.taxablePaise)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{d.cgstPaise != null ? inr((d.cgstPaise || 0) + (d.sgstPaise || 0) + (d.igstPaise || 0)) : "—"}</td>
                      <td style={cell}><code>{d.paymentId}</code></td>
                      <td style={cell}><a href={`/api/admin/payments/${d.id}/pdf`} style={{ color: "#0F6E56", textDecoration: "underline" }}>Download</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
