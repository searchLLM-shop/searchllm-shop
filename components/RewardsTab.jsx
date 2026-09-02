"use client";

// The Rewards tab. Three states: signed out (sign-in prompt), signed in but
// not a member (explainer + explicit consent + join), member (balances,
// redemption, history). Points come from search and click activity ONLY
// (2026-08-25: purchase points removed entirely — only Awin's conversion
// feed was ever actually verified, vCommission's and Amazon's were not, so
// paying points on an unverifiable purchase claim was the problem) —
// points are credited immediately, there is no pending/confirm cycle.
//
// Flat platform-fee model (2026-08-25): there is no Plus plan. Points
// accumulate free from 0, but earning pauses at every 250-point boundary
// (0-250, 250-500, ...) until that block's ₹349 platform fee is paid — a
// one-way ratchet, never re-locks. Paying a block both unlocks it for
// redemption and lets earning resume into the next block. Redemption needs
// no plan check: it's just a balance check against whatever's available.

import { useState, useEffect, useCallback } from "react";
import { useUser, useClerk, SignInButton } from "@clerk/nextjs";
import { LOYALTY } from "@/lib/constants";

const n = (v) => Number(v || 0).toLocaleString();


function VoucherShowcase({ caption }) {
  const byCategory = {};
  for (const v of LOYALTY.VOUCHER_CATALOG) {
    (byCategory[v.category] = byCategory[v.category] || []).push(v.brand);
  }
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>The voucher wall</div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 10 }}>{caption}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {Object.entries(byCategory).map(([category, brands]) => (
          <div key={category} style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "12px 14px", background: "var(--color-background-secondary)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#854F0B", marginBottom: 6 }}>{category}</div>
            <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.6 }}>{brands.join(" · ")}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {LOYALTY.DENOMINATIONS.map((d) => (
          <span key={d} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 12, padding: "3px 11px", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>₹{d.toLocaleString()}</span>
        ))}
      </div>
    </div>
  );
}

export default function RewardsTab() {
  const { isSignedIn, user } = useUser();
  const { openUserProfile } = useClerk();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [voucherType, setVoucherType] = useState("");
  const [busy, setBusy] = useState(false);
  const [payingFee, setPayingFee] = useState(false);
  const [notice, setNotice] = useState(null);
  // RBI KYC confirmation step (2026-09-02): first/last name and mobile are
  // no longer typed here at all — they're read straight from the Clerk
  // account (sign-up is phone-only now, so mobile in particular IS the
  // account's identifier) and shown locked, so they can't drift from what
  // the account actually says. Email and the postal address ARE typed here
  // — email because sign-up no longer collects it at all, address because
  // it never has.
  const [pendingDenom, setPendingDenom] = useState(null);
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");

  // The account profile fields RBI KYC needs, straight from Clerk — never
  // client-typed, never trusted from anywhere else. The server independently
  // re-derives the same thing from the session on redeem, so this is purely
  // for display; it can't be spoofed into unlocking a redemption.
  const accountKyc = {
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    mobile: user?.primaryPhoneNumber?.phoneNumber || "",
  };
  const accountKycComplete = Boolean(accountKyc.firstName && accountKyc.lastName && accountKyc.mobile);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const load = useCallback(async () => {
    if (!isSignedIn) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/rewards");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      if (!voucherType && json.config?.VOUCHER_CATALOG?.length) setVoucherType(json.config.VOUCHER_CATALOG[0].brand);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function act(body, successMsg) {
    setBusy(true);
    setNotice(null);
    try {
      const resp = await fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed");
      setNotice(successMsg);
      await load();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function payPlatformFee() {
    setPayingFee(true);
    setNotice(null);
    try {
      const resp = await fetch("/api/checkout", { method: "POST" });
      const json = await resp.json();
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      throw new Error(json.detail || json.error || "Checkout did not return a payment link");
    } catch (e) {
      setNotice(e.message || "Couldn't start the payment. Please try again.");
      setPayingFee(false);
    }
  }

  if (!isSignedIn) {
    return (
      <div style={{ textAlign: "center", padding: "40px 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Earn points just by researching</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 460, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Members earn points on every pick and every recommended-product link they click — redeemable for Amazon Pay, Flipkart, and Swiggy vouchers. Sign in to join, free.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", maxWidth: 460, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Separately, worth knowing: brands don&apos;t pay to be featured or clicked, and we only earn anything ourselves when you actually buy — that revenue never influences which product we recommend.
        </p>
        <SignInButton mode="modal">
          <button style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Sign in to get started
          </button>
        </SignInButton>
        <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
          <VoucherShowcase caption={`What points turn into — earn free from your first pick, every ${LOYALTY.POINTS_BLOCK_SIZE} points is a ₹${LOYALTY.PLATFORM_FEE_INR} platform fee away from a voucher.`} />
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  const cfg = data.config || {};
  const blockSize = cfg.POINTS_BLOCK_SIZE || LOYALTY.POINTS_BLOCK_SIZE;
  const feeInr = cfg.PLATFORM_FEE_INR || LOYALTY.PLATFORM_FEE_INR;

  if (!data.isMember) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Join the rewards programme</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.8, marginBottom: 8 }}>
          Earn points two ways, the same rate for everyone: <strong>every pick you research</strong> ({cfg.POINTS?.SEARCH} points each) and <strong>every recommended product link you click</strong> ({cfg.POINTS?.CLICK} points, once per product per day). Purchases earn no points — nothing about what you buy is linked to your rewards balance. 1 point = ₹1 of voucher value. Points build up free from zero, but pause at every {blockSize}-point mark ({blockSize}, {blockSize * 2}, …) until you pay a ₹{feeInr} platform fee for that block — paying unlocks that block&apos;s voucher and lets earning carry on into the next one.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: 8 }}>
          Separately, worth knowing: brands don&apos;t pay to be featured or clicked, and we only earn anything ourselves when you actually buy — that&apos;s also why the pick you&apos;re shown is never influenced by which one pays us more.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: 14 }}>
          Redeeming a voucher uses the first name, last name and mobile on your account, plus an email and postal address you confirm each time — a gift-voucher rule set by the RBI in India, not something we chose.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            I understand points come from my own picks and clicks only, as described in the <a href="/privacy" target="_blank" style={{ color: "#0F6E56" }}>Privacy Policy</a>. My purchases are never linked to this programme or my points balance.
          </span>
        </label>
        <button
          disabled={!consentChecked || busy}
          onClick={() => act({ action: "join" }, "Welcome to the programme — points accrue from your next pick onward.")}
          style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: consentChecked ? "pointer" : "default", opacity: consentChecked ? 1 : 0.5 }}
        >
          Join — it&apos;s free
        </button>
        {notice && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 10 }}>{notice}</div>}
        <VoucherShowcase caption={`What points turn into — every ${blockSize}-point block is one ₹${feeInr} platform fee away from a voucher.`} />
      </div>
    );
  }

  const available = data.available;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 12 }}>Your rewards</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
        <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Available to redeem</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: "#0F6E56", lineHeight: 1.1 }}>{n(available)}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>= ₹{n(available * (cfg.POINT_VALUE_INR || 1))}</div>
        </div>
        <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Lifetime confirmed</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{n(Math.floor(data.confirmed))}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 18 }}>
        {data.searchPointsToday || 0} points earned today — every pick earns {cfg.POINTS?.SEARCH}, every product-link click earns {cfg.POINTS?.CLICK}. <a href="/points" style={{ color: "#0F6E56" }}>How points work</a>
      </div>

      <div style={{ border: data.atCeiling ? "1px solid #EADFC8" : "0.5px solid var(--color-border-tertiary)", background: data.atCeiling ? "#FDF8EF" : "none", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: data.atCeiling ? "#854F0B" : "var(--color-text-primary)" }}>
          {data.atCeiling ? `You've reached ${n(data.ceiling)} points` : `Progress toward your next ${n(blockSize)}-point block`}
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--color-background-tertiary)", overflow: "hidden", marginBottom: 8 }}>
          <div style={{ height: "100%", width: `${Math.min(100, ((data.totalPoints - (data.ceiling - blockSize)) / blockSize) * 100)}%`, background: "#0F6E56", borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          {data.atCeiling
            ? <>You&apos;ve earned {n(data.totalPoints)} points — that&apos;s the cap for this block, so <strong>no further points until you pay the ₹{feeInr} platform fee</strong> for it. Paying unlocks this block&apos;s voucher and lets earning carry on toward {n(data.ceiling + blockSize)}.</>
            : <>{n(data.totalPoints)} of {n(data.ceiling)} points — once you reach {n(data.ceiling)}, earning pauses until you pay the ₹{feeInr} platform fee for that block.</>}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={payPlatformFee}
              disabled={payingFee}
              style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 500, cursor: payingFee ? "default" : "pointer", opacity: payingFee ? 0.6 : 1 }}
            >
              {payingFee ? "Redirecting…" : `Pay ₹${feeInr} platform fee`}
            </button>
          </div>
          <VoucherShowcase caption="What your points can become the moment you pay:" />
        </div>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Redeem points</div>
        {pendingDenom == null ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }}>
                {(cfg.VOUCHER_CATALOG || []).map((v) => <option key={v.brand} value={v.brand}>{v.brand} · {v.category}</option>)}
              </select>
              {(cfg.DENOMINATIONS || []).map((d) => (
                <button
                  key={d}
                  disabled={busy || d > available}
                  onClick={() => { setAddress(data.storedKyc?.address || ""); setEmail(data.storedKyc?.email || ""); setPendingDenom(d); setNotice(null); }}
                  style={{ background: d <= available ? "#854F0B" : "none", color: d <= available ? "#fff" : "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 500, cursor: d <= available ? "pointer" : "default", opacity: busy ? 0.5 : 1 }}
                >
                  ₹{n(d)}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>
              Vouchers come in fixed denominations; the points equivalent is deducted from your available balance.
            </div>
          </>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
              This ₹{n(pendingDenom)} {voucherType} voucher will be issued to the name and mobile on your account, plus the email and address you confirm below — required every time by the RBI&apos;s rules for gift vouchers in India.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginBottom: 10 }}>
              {/* Locked, filled boxes — not inputs. Name/mobile come from
                  the Clerk account (mobile is sign-up's sole identifier now)
                  and can only be changed via the account's own profile,
                  never on this form; showing them as editable text here
                  would imply they could drift from what the account
                  actually says. */}
              {[["First name", accountKyc.firstName], ["Last name", accountKyc.lastName], ["Mobile", accountKyc.mobile]].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>{label}</div>
                  <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "var(--color-background-tertiary)", color: value ? "var(--color-text-primary)" : "#A03530" }}>
                    {value || "Not set"}
                  </div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>Email</div>
                <input
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>Address for delivery</div>
                <input
                  placeholder="Flat, street, city, state, PIN code"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }}
                />
              </div>
            </div>
            {!accountKycComplete && (
              <div style={{ fontSize: 12, color: "#854F0B", background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 8, padding: "8px 10px", marginBottom: 10, lineHeight: 1.6 }}>
                Your account is missing a first name, last name or mobile number — all three are required to issue a voucher.{" "}
                <button onClick={() => openUserProfile()} style={{ background: "none", border: "none", padding: 0, color: "#854F0B", fontWeight: 600, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>
                  Complete your profile
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                disabled={busy || !accountKycComplete || !emailValid || !address.trim()}
                onClick={async () => {
                  await act(
                    { action: "redeem", voucherType, points: pendingDenom, email, address, kycConfirmed: true },
                    "Redemption requested — your voucher code will appear below once issued (usually within 2 working days)."
                  );
                  setPendingDenom(null);
                }}
                style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 500, cursor: "pointer", opacity: busy ? 0.5 : 1 }}
              >
                Confirm & redeem
              </button>
              <button
                disabled={busy}
                onClick={() => setPendingDenom(null)}
                style={{ background: "none", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 16px", fontSize: 12, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {notice && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 8 }}>{notice}</div>}
      </div>

      {data.redemptions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Redemptions</div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.redemptions.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1 }}>{n(r.points)} pts → {r.voucher_type}</span>
                {r.status === "fulfilled" ? (
                  <code style={{ fontSize: 12, background: "var(--color-background-tertiary)", padding: "2px 8px", borderRadius: 5, color: "#0F6E56", fontWeight: 600 }}>{r.voucher_code}</code>
                ) : (
                  <span style={{ fontSize: 11, color: r.status === "rejected" ? "#A03530" : "#854F0B" }}>{r.status}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Points history</div>
        {data.ledger.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            No points yet — run a search or click a recommended product link to start earning.
          </div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.ledger.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.source === "search" ? (e.note?.startsWith("guest day claim") ? "Guest day points (claimed on signup)" : "Search pick") : e.source === "click" ? `Link click${e.product ? ` · ${e.product.slice(0, 40)}` : ""}` : (e.product || "Purchase")}{e.source === "purchase" && e.brand ? ` · ${e.brand}` : ""}
                </span>
                <span style={{ fontWeight: 600, color: e.status === "confirmed" ? "#0F6E56" : e.status === "reversed" ? "#A03530" : "var(--color-text-secondary)" }}>
                  {e.status === "reversed" ? "—" : `+${n(Math.floor(e.points))}`}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", width: 66, textAlign: "right" }}>{e.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
