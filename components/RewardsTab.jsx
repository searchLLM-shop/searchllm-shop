"use client";

// The Rewards tab. Three states: signed out (sign-in prompt), signed in but
// not a member (explainer + explicit consent + join), member (balances,
// redemption, history). The lifecycle is explained honestly and repeatedly:
// points confirm only when the network approves the commission, 30–90 days
// after purchase — the same way every Indian cashback programme works, and
// the only way a points programme can be truthful about returns.

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { LOYALTY, planPriceLabel } from "@/lib/constants";

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
  const { isSignedIn } = useUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [voucherType, setVoucherType] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  // RBI KYC confirmation step (2026-08-25): clicking a denomination no
  // longer redeems immediately — it opens this inline form, prefilled from
  // whatever's on file, and every redemption re-confirms it explicitly.
  const [pendingDenom, setPendingDenom] = useState(null);
  const [kyc, setKyc] = useState({ firstName: "", lastName: "", mobile: "", email: "", address: "" });

  const load = useCallback(async () => {
    if (!isSignedIn) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/rewards");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      if (!voucherType && json.config?.VOUCHERS?.length) setVoucherType(json.config.VOUCHERS[0]);
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

  if (!isSignedIn) {
    return (
      <div style={{ textAlign: "center", padding: "40px 16px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Earn points on what you buy</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 460, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Members earn points on purchases made through our recommendations — redeemable for Amazon Pay, Flipkart, and Swiggy vouchers. Sign in to join, free.
        </p>
        <SignInButton mode="modal">
          <button style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Sign in to get started
          </button>
        </SignInButton>
        <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
          <VoucherShowcase caption="What points turn into — earn free from your first pick, redeem as a Plus member." />
        </div>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  const cfg = data.config || {};

  if (!data.isMember) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Join the rewards programme</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.8, marginBottom: 8 }}>
          Earn points three ways, the same rate for everyone: <strong>every pick you research</strong> ({cfg.POINTS?.SEARCH} points each), <strong>every recommended product link you click</strong> ({cfg.POINTS?.CLICK} points, once per product per day), and <strong>every purchase a partner store confirms</strong> ({cfg.POINTS?.PURCHASE} points, whatever the order size). 1 point = ₹1 of voucher value. On a free account, points stop at {cfg.VOUCHER_UNLOCK_POINTS} — upgrading to Plus lifts that ceiling for good, and is also what lets you redeem a voucher.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: 14 }}>
          Points show as pending first, and confirm once the store approves the sale — typically 30–90 days after purchase, because stores wait out the return window. Returned or cancelled orders don&apos;t earn. Redeeming a voucher (Plus only) asks for your first name, last name, mobile, email and address each time — a gift-voucher rule set by the RBI in India, not something we chose.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            I understand that joining links purchases I make through SearchLLM&apos;s links to my account, so my points can be calculated — as described in the <a href="/privacy" target="_blank" style={{ color: "#0F6E56" }}>Privacy Policy</a>. Outside this programme, SearchLLM keeps no purchase history about me.
          </span>
        </label>
        <button
          disabled={!consentChecked || busy}
          onClick={() => act({ action: "join" }, "Welcome to the programme — points accrue from your next purchase onward.")}
          style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: consentChecked ? "pointer" : "default", opacity: consentChecked ? 1 : 0.5 }}
        >
          Join — it&apos;s free
        </button>
        {notice && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 10 }}>{notice}</div>}
        <VoucherShowcase caption="What points turn into — accumulate free, redeem as a Plus member." />
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
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Pending</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{n(Math.floor(data.pending))}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>confirms in 30–90 days</div>
        </div>
        <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Lifetime confirmed</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>{n(Math.floor(data.confirmed))}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 18 }}>
        {data.searchPointsToday || 0} points earned today — every pick earns {cfg.POINTS?.SEARCH}, every product-link click earns {cfg.POINTS?.CLICK}, and confirmed purchases earn {cfg.POINTS?.PURCHASE} each. <a href="/points" style={{ color: "#0F6E56" }}>How points work</a>
      </div>

      {data.plan !== "plus" && (
        <div style={{ border: data.canClaimVoucher ? "1px solid #EADFC8" : "0.5px solid var(--color-border-tertiary)", background: data.canClaimVoucher ? "#FDF8EF" : "none", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: data.canClaimVoucher ? "#854F0B" : "var(--color-text-primary)" }}>
            {data.canClaimVoucher ? "You've reached the maximum for a free account" : "Progress toward your first voucher"}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--color-background-tertiary)", overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${Math.min(100, (data.totalPoints / (cfg.VOUCHER_UNLOCK_POINTS || 250)) * 100)}%`, background: "#0F6E56", borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {data.canClaimVoucher
              ? <>You&apos;ve earned {n(data.totalPoints)} of {n(cfg.VOUCHER_UNLOCK_POINTS)} points — that&apos;s the cap for a free account, so <strong>no further points until you upgrade</strong>. Pay for Plus to lift the cap (points keep adding up with no limit) and unlock redeeming a voucher.</>
              : <>{n(data.totalPoints)} of {n(cfg.VOUCHER_UNLOCK_POINTS)} points — once you reach {n(cfg.VOUCHER_UNLOCK_POINTS)}, earning pauses until you pay for Plus, which also unlocks redeeming your first voucher.</>}
            <div style={{ marginTop: 8 }}>
              <a href="/?upgrade=1" style={{ display: "inline-block", background: "#0F6E56", color: "#fff", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 500, textDecoration: "none" }}>Upgrade to Plus — {planPriceLabel()}</a>
            </div>
            <VoucherShowcase caption="What your points can become the moment you upgrade:" />
          </div>
        </div>
      )}

      {data.plan === "plus" && (
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
                    onClick={() => { setKyc({ firstName: data.storedKyc?.firstName || "", lastName: data.storedKyc?.lastName || "", mobile: data.storedKyc?.mobile || "", email: data.storedKyc?.email || "", address: data.storedKyc?.address || "" }); setPendingDenom(d); setNotice(null); }}
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
                Confirm the details this ₹{n(pendingDenom)} {voucherType} voucher will be issued against — required every time by the RBI&apos;s rules for gift vouchers in India, even when it&apos;s the same as last time.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginBottom: 10 }}>
                <input placeholder="First name" value={kyc.firstName} onChange={(e) => setKyc((k) => ({ ...k, firstName: e.target.value }))} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }} />
                <input placeholder="Last name" value={kyc.lastName} onChange={(e) => setKyc((k) => ({ ...k, lastName: e.target.value }))} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }} />
                <input placeholder="Mobile (10 digits)" value={kyc.mobile} onChange={(e) => setKyc((k) => ({ ...k, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }} />
                <input placeholder="Email" value={kyc.email} onChange={(e) => setKyc((k) => ({ ...k, email: e.target.value }))} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }} />
                <input placeholder="Address" value={kyc.address} onChange={(e) => setKyc((k) => ({ ...k, address: e.target.value }))} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "7px 9px", fontSize: 12, background: "none", color: "var(--color-text-primary)", gridColumn: "1 / -1" }} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  disabled={busy || !kyc.firstName.trim() || !kyc.lastName.trim() || !kyc.address.trim() || !/^\d{10}$/.test(kyc.mobile) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kyc.email)}
                  onClick={async () => {
                    await act(
                      { action: "redeem", voucherType, points: pendingDenom, kyc, kycConfirmed: true },
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
      )}

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
            No points yet — they appear here after a store confirms a purchase you made through our links.
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
