"use client";

import { useState, useEffect, useCallback } from "react";

// Small presentational helpers -------------------------------------------

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent || "var(--color-text-primary)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 10 }}>{note}</div>}
      {children}
    </div>
  );
}

function Bar({ value, max, color = "#0F6E56" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--color-background-tertiary)", borderRadius: 3, height: 6, overflow: "hidden", minWidth: 60 }}>
      <div style={{ width: `${pct}%`, background: color, height: "100%" }} />
    </div>
  );
}

const n = (v) => Number(v || 0).toLocaleString();

export default function ReportsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  // Custom date range. When applied, it overrides the preset; picking a
  // preset clears it. draft* hold the inputs until Apply so typing a date
  // doesn't fire a fetch per keystroke.
  const [customRange, setCustomRange] = useState(null);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rangeQ = customRange ? `&from=${customRange.from}&to=${customRange.to}` : "";
      const resp = await fetch(`/api/admin/reports?days=${days}${rangeQ}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.detail || json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days, customRange]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13 }}>Loading reports…</div>;
  }
  if (error) {
    return <div style={{ padding: 14, background: "#FDF3F2", border: "0.5px solid #E8C9C6", borderRadius: 8, color: "#A03530", fontSize: 12 }}>{error}</div>;
  }
  if (!data) return null;

  const t = data.totals || {};
  const a = data.activity || {};

  const searches = Number(t.total_searches || 0);
  const clicks = Number(t.total_clicks || 0);
  const noMatch = Number(t.no_match_searches || 0);

  // The metric that actually matters commercially: of the searches we ran,
  // how many produced a click on a partner product?
  const clickRate = searches > 0 ? ((clicks / searches) * 100).toFixed(1) : "0.0";
  // And how often did we have nothing relevant to show at all? That's an
  // inventory gap, not a user problem.
  const coverage = searches > 0 ? (100 - (noMatch / searches) * 100).toFixed(0) : "0";

  const maxDaily = Math.max(1, ...data.daily.map((d) => Number(d.searches || 0)));
  const maxClicks = Math.max(1, ...(data.topProducts || []).map((p) => Number(p.clicks || 0)));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Reports</h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 6px", fontSize: 11, color: "var(--color-text-secondary)", background: "none" }} />
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>to</span>
          <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 6px", fontSize: 11, color: "var(--color-text-secondary)", background: "none" }} />
          <button
            disabled={!draftFrom || !draftTo}
            onClick={() => setCustomRange({ from: draftFrom, to: draftTo })}
            style={{ background: customRange ? "#0F6E56" : "none", color: customRange ? "#fff" : "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: (!draftFrom || !draftTo) ? "default" : "pointer", opacity: (!draftFrom || !draftTo) ? 0.5 : 1 }}
          >
            Apply
          </button>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => { setDays(d); setCustomRange(null); setDraftFrom(""); setDraftTo(""); }}
              style={{
                background: !customRange && days === d ? "#0F6E56" : "none",
                color: !customRange && days === d ? "#fff" : "var(--color-text-secondary)",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
          <button onClick={load} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "var(--color-text-secondary)" }}>
            Refresh
          </button>
          {/* A plain link, not a fetch: the browser handles the download and
              the admin session cookie rides along automatically. */}
          <a href={`/api/admin/reports/export?days=${days}${customRange ? `&from=${customRange.from}&to=${customRange.to}` : ""}`} style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 500, textDecoration: "none" }}>
            Export XLSX
          </a>
        </div>
      </div>

      <Section title="Audience">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <Stat label="Total visitors" value={n(t.total_visitors)} sub="unique, all time" />
          <Stat label="Registered users" value={n(t.registered_users)} />
          <Stat label="Active today" value={n(a.dau)} sub="ran at least one search" />
          <Stat label="Active this week" value={n(a.wau)} />
          <Stat label="Active this month" value={n(a.mau)} sub="MAU" />
        </div>
      </Section>

      <Section title="Engagement and revenue" note="Click rate is the number that matters commercially — searches that led someone to a partner product.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <Stat label="Total searches" value={n(searches)} />
          <Stat label="Affiliate clicks" value={n(clicks)} accent="#854F0B" />
          <Stat label="Click rate" value={`${clickRate}%`} sub="clicks per search" accent="#854F0B" />
          <Stat label="Inventory coverage" value={`${coverage}%`} sub="searches with a relevant offer" />
          <Stat label="Hit daily limit" value={n(t.limit_hits)} sub="times users ran out of picks" />
        </div>
      </Section>

      <Section
        title={customRange ? `Revenue — ${customRange.from} to ${customRange.to}` : `Revenue — last ${days} days`}
        note="Conversions are matched to outbound clicks by sub-ID and settle over 30–90 days: pending means inside the return window; approved means the commission is confirmed payable. Amounts are per network and currency — they are deliberately never summed across currencies."
      >
        {(() => {
          const rv = data.revenue || {};
          const rt = rv.totals || {};
          const convRate = Number(rt.out_clicks) > 0 ? ((Number(rt.conversions) / Number(rt.out_clicks)) * 100).toFixed(1) : "0.0";
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
                <Stat label="Outbound clicks" value={n(rt.out_clicks)} sub="tracked via /out/" accent="#854F0B" />
                <Stat label="Conversions" value={n(rt.conversions)} sub={`${convRate}% of clicks`} accent="#854F0B" />
                <Stat label="Pending" value={n(rt.pending)} sub="inside return window" />
                <Stat label="Approved" value={n(rt.approved)} accent="#0F6E56" />
                <Stat label="Declined" value={n(rt.declined)} sub="returned / cancelled" />
              </div>
              {(!rv.byNetwork || rv.byNetwork.length === 0) ? (
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                  No tracked clicks in this window yet. Rows appear as soon as shoppers click through /out/ links; commission figures appear once the conversion poll matches network transactions back to them.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 560, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 50px 60px 60px 80px 80px 80px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
                    <span>Network</span><span>Cur</span><span style={{ textAlign: "right" }}>Clicks</span><span style={{ textAlign: "right" }}>Conv</span><span style={{ textAlign: "right" }}>Order value</span><span style={{ textAlign: "right" }}>Comm. pending</span><span style={{ textAlign: "right" }}>Comm. approved</span>
                  </div>
                  {rv.byNetwork.map((x, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 50px 60px 60px 80px 80px 80px", gap: 8, padding: "8px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <span>{x.network || "—"}</span>
                      <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>{x.currency}</span>
                      <span style={{ textAlign: "right" }}>{n(x.out_clicks)}</span>
                      <span style={{ textAlign: "right" }}>{n(x.conversions)}</span>
                      <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{n(x.order_value)}</span>
                      <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{n(x.commission_pending)}</span>
                      <span style={{ textAlign: "right", fontWeight: 500, color: Number(x.commission_approved) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{n(x.commission_approved)}</span>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </>
          );
        })()}
      </Section>

      <Section title={customRange ? `Daily activity — ${customRange.from} to ${customRange.to}` : `Daily activity — last ${days} days`}>
        <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 60px 60px 60px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
            <span>Date</span><span>Searches</span><span style={{ textAlign: "right" }}>Search</span><span style={{ textAlign: "right" }}>Users</span><span style={{ textAlign: "right" }}>Clicks</span>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {data.daily.map((d) => (
              <div key={d.day} style={{ display: "grid", gridTemplateColumns: "90px 1fr 60px 60px 60px", gap: 8, padding: "7px 12px", fontSize: 12, alignItems: "center", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>
                  {new Date(d.day).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                </span>
                <Bar value={Number(d.searches)} max={maxDaily} />
                <span style={{ textAlign: "right" }}>{n(d.searches)}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{n(d.active_users)}</span>
                <span style={{ textAlign: "right", color: Number(d.clicks) > 0 ? "#854F0B" : "var(--color-text-tertiary)" }}>{n(d.clicks)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Most clicked products" note="What people actually click through to buy.">
        {(!data.topProducts || data.topProducts.length === 0) ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "12px 0" }}>No affiliate clicks recorded yet.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.topProducts.map((p, i) => (
              <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.product}
                  <span style={{ color: "var(--color-text-tertiary)" }}> · {p.brand}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{p.network}</span>
                <div style={{ width: 70 }}><Bar value={Number(p.clicks)} max={maxClicks} color="#854F0B" /></div>
                <span style={{ width: 34, textAlign: "right", fontWeight: 500 }}>{n(p.clicks)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Clicks by network">
        {(!data.byNetwork || data.byNetwork.length === 0) ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No clicks yet.</div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.byNetwork.map((x) => (
              <div key={x.network} style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "8px 14px", fontSize: 12 }}>
                <span style={{ color: "var(--color-text-secondary)" }}>{x.network}</span>
                <span style={{ fontWeight: 600, marginLeft: 8 }}>{n(x.clicks)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Most active users" note="Identified by account or anonymous session token — no shopping history is stored against either.">
        <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
          {data.topUsers.map((u, i) => (
            <div key={u.identity} style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 90px", gap: 8, padding: "7px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {String(u.identity).startsWith("user_") ? "registered" : "guest"} · {String(u.identity).slice(-8)}
              </span>
              <span style={{ textAlign: "right" }}>{n(u.searches)}</span>
              <span style={{ textAlign: "right", color: "var(--color-text-tertiary)" }}>{n(u.active_days)}d</span>
              <span style={{ textAlign: "right", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                {new Date(u.last_seen).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Where visitors come from" note="First-party attribution — no third-party trackers involved.">
        {(!data.sources || data.sources.length === 0) ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No visits recorded yet.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            {data.sources.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px 60px", gap: 8, padding: "8px 12px", fontSize: 12, borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)" }}>
                <span>{s.source}</span>
                <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>{s.campaign || s.medium || "—"}</span>
                <span style={{ textAlign: "right" }}>{n(s.visitors)}</span>
                <span style={{ textAlign: "right", color: "var(--color-text-tertiary)" }}>{n(s.visits)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Campaign performance" note="Visitors, the searches they ran, and the partner clicks they produced — what an ad campaign actually returned.">
        {(!data.campaigns || data.campaigns.length === 0) ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Nothing to show yet.</div>
        ) : (
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 70px 70px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
              <span>Source</span><span>Campaign</span><span style={{ textAlign: "right" }}>Visitors</span><span style={{ textAlign: "right" }}>Searches</span><span style={{ textAlign: "right" }}>Clicks</span>
            </div>
            {data.campaigns.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 70px 70px", gap: 8, padding: "8px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <span>{c.source}</span>
                <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>{c.campaign || "—"}</span>
                <span style={{ textAlign: "right" }}>{n(c.visitors)}</span>
                <span style={{ textAlign: "right" }}>{n(c.searches)}</span>
                <span style={{ textAlign: "right", color: Number(c.affiliate_clicks) > 0 ? "#854F0B" : "var(--color-text-tertiary)" }}>{n(c.affiliate_clicks)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {data.rewards && (
        <Section title="Rewards programme" note={`${n(data.rewards.members)} members · outstanding liability: ${n(data.rewards.outstandingPoints)} points (₹${n(data.rewards.outstandingPoints)})`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {data.rewards.issuance.map((x, i) => (
              <div key={i} style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "7px 12px", fontSize: 11 }}>
                <span style={{ color: "var(--color-text-tertiary)" }}>{x.source} · {x.status}</span>
                <span style={{ fontWeight: 600, marginLeft: 8 }}>{n(Math.floor(x.points))} pts</span>
              </div>
            ))}
          </div>
          {(data.rewards.feedback || []).length > 0 && (
            <div style={{ margin: "10px 0" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 6 }}>Why engaged users say they don&apos;t buy (checkpoint feedback):</div>
              {data.rewards.feedback.map((f, i) => (
                <div key={i} style={{ fontSize: 12, padding: "5px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)" }}>
                  <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>[{f.kind} · block {f.block_number} · {f.user_prefix}…]</span> {f.feedback}
                </div>
              ))}
            </div>
          )}
          {data.rewards.byVoucher.length > 0 && (
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 110px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
                <span>Voucher</span><span style={{ textAlign: "right" }}>Status</span><span style={{ textAlign: "right" }}>Count</span><span style={{ textAlign: "right" }}>Value (₹)</span>
              </div>
              {data.rewards.byVoucher.map((v, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 110px", gap: 8, padding: "7px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <span>{v.voucher_type}</span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "var(--color-text-tertiary)" }}>{v.status}</span>
                  <span style={{ textAlign: "right" }}>{n(v.redemptions)}</span>
                  <span style={{ textAlign: "right", fontWeight: 500 }}>{n(v.points_value)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Inventory" note="Approved listings are what can actually be shown to a shopper.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {data.inventory.map((x, i) => (
            <div key={i} style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "7px 12px", fontSize: 11 }}>
              <span style={{ color: "var(--color-text-tertiary)" }}>{x.network} · {x.status}</span>
              <span style={{ fontWeight: 600, marginLeft: 8 }}>{n(x.listings)}</span>
            </div>
          ))}
        </div>
      
        {(data.inventoryByCountry || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
              By country. A listing serving several countries counts once per country; listings with no region data are unrestricted (servable anywhere).
            </div>
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
                <span>Country</span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right" }}>Approved</span><span style={{ textAlign: "right" }}>Pending</span>
              </div>
              {data.inventoryByCountry.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, padding: "7px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <span>{c.country}</span>
                  <span style={{ textAlign: "right" }}>{n(c.total)}</span>
                  <span style={{ textAlign: "right", fontWeight: 500, color: Number(c.approved) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{n(c.approved)}</span>
                  <span style={{ textAlign: "right", color: "var(--color-text-tertiary)" }}>{n(c.pending)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(data.inventoryByCategory || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
              By category — the site's own taxonomy, assigned at sync time.
            </div>
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, padding: "8px 12px", background: "var(--color-background-tertiary)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)" }}>
                <span>Category</span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right" }}>Approved</span><span style={{ textAlign: "right" }}>Pending</span>
              </div>
              {data.inventoryByCategory.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px", gap: 8, padding: "7px 12px", fontSize: 12, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                  <span style={{ textAlign: "right" }}>{n(c.total)}</span>
                  <span style={{ textAlign: "right", fontWeight: 500, color: Number(c.approved) > 0 ? "#0F6E56" : "var(--color-text-tertiary)" }}>{n(c.approved)}</span>
                  <span style={{ textAlign: "right", color: "var(--color-text-tertiary)" }}>{n(c.pending)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
