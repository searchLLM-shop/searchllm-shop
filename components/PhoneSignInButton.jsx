"use client";

// Drop-in replacement for Clerk's <SignInButton mode="modal"> (2026-09-22,
// RBI data-localization fix — see lib/phoneAuth.js's header comment for
// the full story). Same API shape — wrap a single <button> child exactly
// as SignInButton was used everywhere in this app — so every call site
// only needed its import swapped, not its JSX restructured.
//
// Clerk still issues the actual session (useSignIn's "ticket" strategy,
// verified against Clerk's current docs 2026-09-22) — this only changes
// how the phone number itself is collected and verified: entirely
// through our own /api/auth/send-otp and /api/auth/verify-otp, on our
// own India-hosted infrastructure, so the real number is never sent to
// Clerk at all.

import { useState, cloneElement } from "react";
import { useSignIn } from "@clerk/nextjs";

const inputStyle = {
  width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 8,
  border: "1px solid #D1D5DB", outline: "none", boxSizing: "border-box",
};
const primaryButtonStyle = {
  width: "100%", background: "#0F6E56", color: "#fff", border: "none",
  borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 500,
  cursor: "pointer", marginTop: 12,
};

export default function PhoneSignInButton({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {cloneElement(children, { onClick: () => setOpen(true) })}
      {open && <PhoneAuthModal onClose={() => setOpen(false)} />}
    </>
  );
}

function PhoneAuthModal({ onClose }) {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [step, setStep] = useState("phone"); // "phone" | "otp"
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Could not send the code.");
      setStep("otp");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Incorrect code.");

      // Exchange the short-lived Clerk sign-in token for a real session —
      // Clerk's documented "ticket" strategy for custom auth flows.
      const attempt = await signIn.create({ strategy: "ticket", ticket: json.signInToken });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
        onClose();
      } else {
        throw new Error("Sign-in could not be completed — please try again.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, padding: 24, width: 320, maxWidth: "90vw" }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          {step === "phone" ? "Sign in with your phone" : "Enter the code"}
        </div>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>
          {step === "phone"
            ? "We'll text you a one-time code."
            : `Sent to ${phone} — valid for 5 minutes.`}
        </div>

        {step === "phone" ? (
          <form onSubmit={sendOtp}>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
              autoFocus
              required
            />
            <button type="submit" disabled={busy} style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
              autoFocus
              required
            />
            <button type="submit" disabled={busy} style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("phone"); setCode(""); setError(null); }}
              style={{ width: "100%", background: "none", border: "none", color: "#6B7280", fontSize: 12, marginTop: 10, cursor: "pointer", textDecoration: "underline" }}
            >
              Use a different number
            </button>
          </form>
        )}

        {error && <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 10 }}>{error}</div>}

        <button
          type="button"
          onClick={onClose}
          style={{ width: "100%", background: "none", border: "none", color: "#9CA3AF", fontSize: 12, marginTop: 14, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
