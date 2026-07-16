"use client";

import { useState, useCallback, useRef } from "react";
import { ALTERNATIVES_POOL } from "@/lib/constants";

const STEPS = ["Reading your question", "Checking current options", "Weighing trade-offs", "Writing the honest version"];

function pickAlternatives(category) {
  const pool = ALTERNATIVES_POOL.filter((a) =>
    (category === "outdoor" && /jacket|pack|hik/i.test(a.name)) ||
    (category === "electronics" && /headphone|sony|sennheiser/i.test(a.name)) ||
    (category === "beauty" && /roche|spf/i.test(a.name))
  );
  return pool.length ? pool : ALTERNATIVES_POOL.slice(0, 2);
}

export default function ResearchTab({ maxSearches, searchCount, onSearchComplete, onSavePick }) {
  const [query, setQuery] = useState("");
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const fileRef = useRef();
  const [attachment, setAttachment] = useState(null);

  const handleSearch = useCallback(
    async (q) => {
      const searchQ = (q || query).trim();
      if (!searchQ) return;
      if (maxSearches !== -1 && searchCount >= maxSearches) return;

      setProcessing(true);
      setResult(null);
      setErrorMsg(null);
      setStep(0);

      const stepTimer = setInterval(() => {
        setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
      }, 700);

      try {
        const resp = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: searchQ, attachment }),
        });

        if (resp.status === 429) {
          setErrorMsg("Daily free limit reached. Upgrade to Plus for unlimited picks.");
          clearInterval(stepTimer);
          setStep(-1);
          setProcessing(false);
          return;
        }
        if (!resp.ok) throw new Error("Request failed");

        const data = await resp.json();
        const alternatives = pickAlternatives(data.matchedListing ? data.matchedListing.product : "outdoor");

        setResult({ query: searchQ, ...data, alternatives, id: Date.now() });
        onSearchComplete?.();
      } catch (e) {
        console.error(e);
        setErrorMsg("Couldn't complete the research — try rephrasing the question.");
      }

      clearInterval(stepTimer);
      setStep(-1);
      setProcessing(false);
    },
    [query, attachment, searchCount, maxSearches, onSearchComplete]
  );

  const quotaReached = maxSearches !== -1 && searchCount >= maxSearches;

  return (
    <div>
      {!result && !processing && (
        <div style={{ textAlign: "center", padding: "14px 0 22px" }}>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
            Ask a real shopping question. Get one honest pick, with the trade-offs and the alternatives we didn&apos;t choose.
          </p>
        </div>
      )}

      <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", padding: 14, marginBottom: 16 }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSearch(); }}
          placeholder="What's the best rain jacket for a 3-day hike under $200?"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", border: "none", background: "transparent", fontSize: 14, resize: "none", outline: "none", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 11, color: attachment ? "#0F6E56" : "var(--color-text-secondary)" }}>
            {attachment ? attachment.name : "Attach"}
          </button>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) setAttachment({ name: f.name, type: f.type }); }} accept=".pdf,.txt,.docx,.csv,.png,.jpg" />
          {attachment && <button onClick={() => setAttachment(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#D85A30" }}>✕</button>}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Ctrl+Enter</span>
          <button
            onClick={() => handleSearch()}
            disabled={processing || !query.trim() || quotaReached}
            style={{ background: processing || !query.trim() ? "var(--color-background-tertiary)" : "#0F6E56", color: processing || !query.trim() ? "var(--color-text-tertiary)" : "#fff", border: "none", borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
          >
            {processing ? "Researching…" : "Get my pick"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: "#D85A3011", border: "1px solid #D85A3044", borderRadius: 9, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#D85A30" }}>
          {errorMsg}
        </div>
      )}

      {processing && (
        <div style={{ padding: "30px 10px" }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, opacity: step >= i ? 1 : 0.35 }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${step >= i ? "#0F6E56" : "var(--color-border-secondary)"}`, background: step > i ? "#0F6E56" : "transparent", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: step >= i ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>{s}</span>
            </div>
          ))}
        </div>
      )}

      {result && !processing && (
        <div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span>For: &quot;{result.query}&quot;</span>
            {result.searchUsed && (
              <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "#0F6E5618", color: "#0F6E56", fontWeight: 500 }}>
                checked current web results
              </span>
            )}
          </div>

          <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, border: "1.5px solid #0F6E5644", padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.05em", textTransform: "uppercase" }}>Our pick</span>
              {result.confidence && <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>confidence: {result.confidence}</span>}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 10, lineHeight: 1.4 }}>{result.headline}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>{result.reasoning}</div>
            {result.whoItsFor && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}><strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Good for:</strong> {result.whoItsFor}</div>}
            {result.whoShouldSkip && <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}><strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>Skip if:</strong> {result.whoShouldSkip}</div>}
          </div>

          {result.matchedListing && (
            <div style={{ background: "#BA75171A", borderRadius: 12, border: "1px solid #BA751744", padding: "16px 18px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: "#854F0B", letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", background: "#BA751733", borderRadius: 20 }}>
                  Sponsored match · affiliate link via {result.matchedListing.network}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{result.matchedListing.product}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{result.matchedListing.price}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{result.matchedListing.brand} · {result.matchedListing.pitch}</div>
              <a href={result.matchedListing.networkLink} target="_blank" rel="noopener noreferrer sponsored" style={{ display: "inline-block", fontSize: 13, fontWeight: 500, color: "#fff", background: "#854F0B", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
                View and buy →
              </a>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 8 }}>This never changes the price you pay, and it&apos;s never the reason this option was suggested — see alternatives below.</div>
            </div>
          )}

          {result.alternatives?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                We also considered (no affiliate relationship)
              </div>
              {result.alternatives.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{a.note}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", whiteSpace: "nowrap", marginLeft: 12 }}>{a.price}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => onSavePick?.(result)} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>Save this pick</button>
            <button onClick={() => { setResult(null); setQuery(""); setAttachment(null); }} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>New question</button>
          </div>
        </div>
      )}
    </div>
  );
}
