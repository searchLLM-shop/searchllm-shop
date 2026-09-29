"use client";

// The account drawer's Privacy tab — self-service DPDP data-principal
// requests (access/deletion), tracked rather than email-only. See
// Privacy Policy section 8 and schema.sql's privacy_requests comment.

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import PhoneSignInButton from "@/components/PhoneSignInButton";

const STATUS_LABEL = { pending: "Pending", fulfilled: "Completed", rejected: "Declined" };
const STATUS_COLOR = { pending: "#854F0B", fulfilled: "#0F6E56", rejected: "#A03530" };
const TYPE_LABEL = { access: "Copy of my data", delete: "Delete my account" };

export default function PrivacyTab() {
  const { isSignedIn } = useUser();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null); // which type is in flight
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!isSignedIn) { setLoading(false); return; }
    setLoading(true);
    try {
      const resp = await fetch("/api/privacy-request");
      const json = await resp.json();
      setRequests(json.requests || []);
    } catch {
      // fails soft — the request form still works even if history can't load
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => { load(); }, [load]);

  async function submit(type) {
    setSubmitting(type);
    setError(null);
    try {
      const resp = await fetch("/api/privacy-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Could not submit the request.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(null);
    }
  }

  if (!isSignedIn) {
    return (
      <div style={{ textAlign: "center", padding: "40px 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Your data, your rights</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 420, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Sign in to request a copy of your data or ask us to delete your account.
        </p>
        <PhoneSignInButton>
          <button style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Sign in
          </button>
        </PhoneSignInButton>
      </div>
    );
  }

  const pendingTypes = new Set(requests.filter((r) => r.status === "pending").map((r) => r.request_type));

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Your data, your rights</h2>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
        Under India&apos;s Digital Personal Data Protection Act, 2023, you can request a copy of the data we hold
        about you, or ask us to delete your account and its data. We respond within 30 days — see the{" "}
        <a href="/privacy" style={{ color: "#0F6E56" }}>Privacy Policy</a> for details. You can also email{" "}
        <a href="mailto:deploy@pibitsai.com" style={{ color: "#0F6E56" }}>deploy@pibitsai.com</a> directly at any time.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <button
          onClick={() => submit("access")}
          disabled={submitting === "access" || pendingTypes.has("access")}
          style={{ background: "#fff", color: "#0F6E56", border: "1px solid #0F6E56", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 500, cursor: pendingTypes.has("access") ? "default" : "pointer", opacity: pendingTypes.has("access") ? 0.5 : 1 }}
        >
          {pendingTypes.has("access") ? "Request pending…" : submitting === "access" ? "Submitting…" : "Request a copy of my data"}
        </button>
        <button
          onClick={() => submit("delete")}
          disabled={submitting === "delete" || pendingTypes.has("delete")}
          style={{ background: "#fff", color: "#A03530", border: "1px solid #A03530", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 500, cursor: pendingTypes.has("delete") ? "default" : "pointer", opacity: pendingTypes.has("delete") ? 0.5 : 1 }}
        >
          {pendingTypes.has("delete") ? "Request pending…" : submitting === "delete" ? "Submitting…" : "Delete my account and data"}
        </button>
      </div>

      {error && <div style={{ color: "#A03530", fontSize: 12, marginBottom: 14 }}>{error}</div>}

      {!loading && requests.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: "var(--color-text-tertiary)" }}>Your requests</div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {requests.map((r, i) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span>{TYPE_LABEL[r.request_type] || r.request_type}</span>
                <span style={{ color: STATUS_COLOR[r.status], fontWeight: 500 }}>{STATUS_LABEL[r.status] || r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
