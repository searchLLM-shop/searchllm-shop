"use client";

// The Rewards tab. Three states: signed out (sign-in prompt), signed in but
// not a member (explainer + explicit consent + join), member (balances,
// redemption, history). The lifecycle is explained honestly and repeatedly:
// points confirm only when the network approves the commission, 30–90 days
// after purchase — the same way every Indian cashback programme works, and
// the only way a points programme can be truthful about returns.

import { useState, useEffect, useCallback } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
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
  const { isSignedIn } = useUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [voucherType, setVoucherType] = useState("");
  const [redeemPoints, setRedeemPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

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
          Earn points two ways: <strong>every pick you research</strong> ({cfg.SEARCH_POINTS?.USER_PER_PICK} points each, up to {cfg.SEARCH_POINTS?.USER_DAILY_CAP}/day) and <strong>every purchase a partner store confirms</strong> (based on what the store pays us — {cfg.PLUS_MULTIPLIER}× for Plus members, uncapped). 1 point = ₹1 of voucher value. Points accumulate free forever; redeeming them for {(cfg.DENOMINATIONS || []).join("/")}-point vouchers (Amazon Pay, Flipkart, Myntra, Swiggy) is a Plus benefit.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.7, marginBottom: 14 }}>
          Points show as pending first, and confirm once the store approves the sale — typically 30–90 days after purchase, because stores wait out the return window. Returned or cancelled orders don&apos;t earn.
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
        Earn on every pick you research ({data.searchPointsToday || 0}/{cfg.SEARCH_POINTS?.USER_DAILY_CAP} search points today) and on every purchase a store confirms through our links — no cap on those. <a href="/points" style={{ color: "#0F6E56" }}>How points work</a>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Redeem points</div>
        {data.plan !== "plus" ? (
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            🔒 Your points are safe and keep accumulating — <strong>redeeming them is a Plus benefit</strong>. Plus also gives unlimited picks and {cfg.PLUS_MULTIPLIER}× purchase points.
            <div style={{ marginTop: 8 }}>
              <a href="/?upgrade=1" style={{ display: "inline-block", background: "#0F6E56", color: "#fff", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 500, textDecoration: "none" }}>Upgrade to Plus — ₹499/year</a>
            </div>
            <VoucherShowcase caption="What your points can become the moment you upgrade:" />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={voucherType} onChange={(e) => setVoucherType(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "none", color: "var(--color-text-primary)" }}>
                {(cfg.VOUCHER_CATALOG || []).map((v) => <option key={v.brand} value={v.brand}>{v.brand} · {v.category}</option>)}
              </select>
              {(cfg.DENOMINATIONS || []).map((d) => (
                <button
                  key={d}
                  disabled={busy || d > available}
                  onClick={() => act({ action: "redeem", voucherType, points: d }, "Redemption requested — your voucher code will appear below once issued (usually within 2 working days).")}
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
            No points yet — they appear here after a store confirms a purchase you made through our links.
          </div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.ledger.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.source === "search" ? (e.note?.startsWith("guest day claim") ? "Guest day points (claimed on signup)" : "Search pick") : (e.product || "Purchase")}{e.source !== "search" && e.brand ? ` · ${e.brand}` : ""}
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
