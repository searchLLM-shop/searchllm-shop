"use client";

import { useState, useCallback, useRef } from "react";

const STEPS = ["Reading your question", "Checking current options", "Weighing trade-offs", "Writing the honest version"];


// Reads an image file and downscales it before upload. Phone photos are
// routinely 4–8MB, and base64 inflates that by a third — enough to make
// requests slow or fail outright. 1024px on the long edge is plenty for
// identifying a product, and keeps the payload to a few hundred KB.
async function prepareImage(file) {
  const MAX_EDGE = 1024;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not open that image"));
    el.src = dataUrl;
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

  // Normalise to JPEG so we send one predictable media type.
  const out = canvas.toDataURL("image/jpeg", 0.82);
  return { data: out.split(",")[1], mediaType: "image/jpeg" };
}

export default function ResearchTab({ maxSearches, searchCount, onSearchComplete, onSavePick, isAdmin, savedQueries = [], saveNotice }) {
  const [query, setQuery] = useState("");
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [geoOverride, setGeoOverride] = useState("");
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
          body: JSON.stringify({ query: searchQ, attachment, geoOverride: geoOverride || undefined }),
        });

        if (resp.status === 429) {
          setErrorMsg(
            "That's your 8 picks for today. The count resets at midnight UTC — come back tomorrow and we'll pick up where you left off. Your saved picks stay available in the meantime."
          );
          clearInterval(stepTimer);
          setStep(-1);
          setProcessing(false);
          return;
        }
        if (!resp.ok) {
          // Pull the server's real reason so a failure is diagnosable
          // instead of always reading "try rephrasing the question".
          let detail = "";
          try {
            const errBody = await resp.json();
            detail = errBody.detail || errBody.error || "";
          } catch { /* non-JSON error page */ }
          throw new Error(detail || `Request failed (${resp.status})`);
        }

        const data = await resp.json();
        setResult({ query: searchQ, ...data, alternatives: data.alternatives || [], id: Date.now() });
        onSearchComplete?.();
      } catch (e) {
        console.error(e);
        setErrorMsg(
          e.message && e.message !== "Request failed"
            ? `Couldn't complete the research: ${e.message}`
            : "Couldn't complete the research — try rephrasing the question."
        );
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

      {isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "7px 12px", background: "var(--color-background-tertiary)", borderRadius: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
          <span style={{ fontWeight: 500 }}>Admin</span>
          <span>· view as</span>
          <select
            value={geoOverride}
            onChange={(e) => setGeoOverride(e.target.value)}
            style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
          >
            <option value="">My location (detected)</option>
            <option value="IN">India</option>
            <option value="GB">United Kingdom</option>
            <option value="US">United States</option>
            <option value="AE">UAE</option>
            <option value="AU">Australia</option>
            <option value="CA">Canada</option>
            <option value="DE">Germany</option>
            <option value="SG">Singapore</option>
          </select>
          {geoOverride && (
            <span style={{ color: "#0F6E56" }}>
              simulating {geoOverride} — offers and prices will match that market
            </span>
          )}
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
            {attachment ? (attachment.preparing ? "Reading…" : attachment.name) : "Attach photo"}
          </button>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              if (!f.type.startsWith("image/")) {
                setAttachment({ name: f.name, type: f.type });
                return;
              }
              setAttachment({ name: f.name, type: f.type, preparing: true });
              try {
                const { data, mediaType } = await prepareImage(f);
                setAttachment({ name: f.name, type: f.type, data, mediaType });
              } catch (err) {
                setErrorMsg(err.message);
                setAttachment(null);
              }
            }} accept=".pdf,.txt,.docx,.csv,.png,.jpg" />
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
            {result.imageUnderstanding && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", background: "var(--color-background-tertiary)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                From your photo, I can see: {result.imageUnderstanding}
              </div>
            )}
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
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {/* Product image makes the recommendation concrete. Kept small
                    and lazily loaded; a broken feed image hides itself rather
                    than leaving a torn placeholder. */}
                {result.matchedListing.imageUrl && (
                  <img
                    src={result.matchedListing.imageUrl}
                    alt={result.matchedListing.product}
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                    style={{ width: 84, height: 84, objectFit: "contain", borderRadius: 8, background: "#fff", flexShrink: 0, border: "0.5px solid var(--color-border-tertiary)" }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{result.matchedListing.product}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>
                      {/* Campaign-level offers have no single price — show
                          nothing rather than a placeholder or a stand-in. */}
                      {result.matchedListing.price || ""}
                      {result.matchedListing.discount && (
                        <span style={{ fontSize: 11, color: "#0F6E56", marginLeft: 6 }}>{result.matchedListing.discount}</span>
                      )}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>
                    {result.matchedListing.brand}{result.matchedListing.pitch ? ` · ${result.matchedListing.pitch}` : ""}
                  </div>
                  <a
                    href={result.matchedListing.networkLink}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    onClick={() => {
                      // sendBeacon is built for exactly this: it survives the
                      // navigation away, so the click is recorded without
                      // delaying the user by even a millisecond.
                      try {
                        const payload = JSON.stringify({
                          eventType: "affiliate_click",
                          listingId: result.matchedListing.id,
                          network: result.matchedListing.network,
                        });
                        if (navigator.sendBeacon) {
                          navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
                        } else {
                          fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
                        }
                      } catch { /* never block the click */ }
                    }} style={{ display: "inline-block", fontSize: 13, fontWeight: 500, color: "#fff", background: "#854F0B", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
                    {result.matchedListing.merchantDomain
                      ? `View on ${result.matchedListing.merchantDomain} →`
                      : "View and buy →"}
                  </a>
                </div>
              </div>
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

          {/* The Terms require users to verify before buying; saying it once in
              a policy nobody reads isn't enough, so it appears with every answer. */}
          <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6, margin: "0 0 14px" }}>
            AI can make mistakes. Check the price, availability and specifications on the
            retailer's own page before buying. We don't sell or ship anything — purchases,
            delivery and returns are between you and the retailer.
          </p>

          {saveNotice && (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>{saveNotice}</div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            {(() => {
              // The button gave no feedback at all when clicked, so it looked
              // broken even though the pick was saved. Reflect the state.
              const isSaved = savedQueries.includes((result.query || "").trim().toLowerCase().replace(/\s+/g, " "));
              return (
                <button
                  onClick={() => onSavePick?.(result)}
                  disabled={isSaved}
                  style={{
                    background: isSaved ? "#0F6E5614" : "none",
                    border: `0.5px solid ${isSaved ? "#0F6E56" : "var(--color-border-secondary)"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    cursor: isSaved ? "default" : "pointer",
                    fontSize: 13,
                    color: isSaved ? "#0F6E56" : "var(--color-text-secondary)",
                  }}
                >
                  {isSaved ? "✓ Saved" : "Save this pick"}
                </button>
              );
            })()}
            <button onClick={() => { setResult(null); setQuery(""); setAttachment(null); }} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>New question</button>
          </div>
        </div>
      )}
    </div>
  );
}
