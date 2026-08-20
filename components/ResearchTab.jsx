"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trackEvent } from "@/lib/track";
import { LOYALTY, planPriceLabel } from "@/lib/constants";
import { t } from "@/lib/i18n";

// Physics-themed processing stages — cosmetic labels over the same four
// real steps the backend actually performs (retrieval, matching, model
// judgment, write-up). Kept as parallel arrays: LABEL is the small
// monospace kicker, STEPS is the human-readable line underneath it.
const STAGE_LABELS = ["BOSONIC", "FERMIONIC", "ANYONIC", "COSMIC"];
const STEPS = ["query synthesis", "checking current options", "weighing trade-offs", "writing the honest verdict"];
// Two-line manifesto the hero rotates through when idle — mirrors the
// searchllm.ai pattern of stating the trust architecture as a claim, not a
// promise, with the load-bearing words picked out in colour.
const MANIFESTO = [
  { plain: ["Picks that "], colored: ["can't", "be", "bought"], trail: "." , body: "The model that writes your pick never sees what we'd earn on it — only product, brand and price. Commission data is attached only after it's already chosen — the order the code runs in, not a promise we're asking you to trust." },
  { plain: ["Picks that "], colored: ["are", "honest"], trail: ".", body: "Price is never the deciding factor unless you raise it. We say plainly when the cheap option is fine, and when it will actually fail at what you asked for." },
];
const GRADIENT_COLORS = ["#8B5CF6", "#EC4899", "#F59E0B", "#7C9A3D", "#0F6E56"];



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

// Extracts the verdict text (headline etc.) from the raw JSON accumulated
// so far. Called ONCE, at the moment runResearch's "pick" event arrives
// (2026-08-19: an earlier version called this on every "delta" for a live
// typing effect — reverted, it read as jumpy "sections popping in abruptly"
// rather than smooth streaming; see runResearch below for the current,
// single-reveal approach that keeps the actual speed win without it).
//
// Two tiers, tried in order for each field:
//   1. A CLOSED match — a real closing quote has streamed in — is the
//      authoritative, correctly-unescaped value (via JSON.parse on the
//      matched string literal). This is the expected path: by the time
//      "pick" fires, these fields (1-5 in the schema) are always already
//      closed, since they precede "alternatives" (field 8).
//   2. An OPEN match — a defensive fallback for the (should-not-happen)
//      case where a field is somehow still mid-value at that point —
//      returns a best-effort, hand-unescaped partial value rather than
//      nothing.
// Order-independent (searches each key separately), so it doesn't assume
// anything about the model's field ordering, only that SYSTEM_PROMPT's
// schema puts these prose fields early enough to matter.
function extractStreamingField(rawText, key) {
  const closed = rawText.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (closed) {
    try { return JSON.parse(closed[1]); } catch { /* fall through to open-match below */ }
  }
  const open = rawText.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$`));
  if (open) {
    // Best-effort unescape of the most common JSON escapes. A trailing lone
    // backslash means we're mid-escape-sequence — drop it for this render,
    // it resolves itself once the next chunk completes the escape.
    return open[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\$/, "");
  }
  return undefined;
}
function extractStreamingFields(rawText) {
  const out = {};
  for (const key of ["headline", "reasoning", "whoItsFor", "whoShouldSkip", "confidence"]) {
    const v = extractStreamingField(rawText, key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export default function ResearchTab({ maxSearches, searchCount, onSearchComplete, onSavePick, isAdmin, savedQueries = [], saveNotice, locale = "en" }) {
  const tr = t(locale);
  const [query, setQuery] = useState("");
  // Rotating placeholder examples. Each models the ideal query shape —
  // product + attribute + budget — so users learn what a good question
  // looks like by osmosis instead of a form. Rotation pauses the moment
  // they start typing (placeholder disappears anyway once query is set).
  const PLACEHOLDER_EXAMPLES = [
    "ubtan face wash under ₹300 for oily skin",
    "55-inch smart TV around ₹1L for a bright living room",
    "gamepad for PC games under ₹1,500",
    "whey protein under ₹2,000 for beginners",
    "maroon ethnic dress under ₹800 for a festive occasion",
    "mixer grinder around ₹3,000 for a small kitchen",
  ];
  // Chips are separate from the rotating placeholders: they must fit one
  // line on a 360px screen, so they're deliberately shorter while still
  // modelling the product + constraint + budget shape.
  const CHIP_EXAMPLES = [
    "face wash for oily skin under ₹300",
    "55-inch TV around ₹1L",
    "gamepad under ₹1,500",
  ];
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  // Rotates the two-line manifesto in the hero every 5s while idle — mirrors
  // the progress-dot pair on searchllm.ai. Paused once a search starts.
  const [manifestoIdx, setManifestoIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setManifestoIdx((i) => (i + 1) % MANIFESTO.length), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (query) return; // don't churn the interval while they type
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), 3500);
    return () => clearInterval(t);
  }, [query, PLACEHOLDER_EXAMPLES.length]);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Pre-research clarifying loop (bosonic layer) — one question at a time
  // from /api/clarify, looping until it says done. clarifyQuery holds the
  // query the loop is currently attached to, separately from `query` (the
  // live textarea value), so editing the box while the loop is open can't
  // desync which question belongs to which search. clarifyHistory
  // accumulates answered {question, answer} pairs across rounds; the
  // shopper's answer to clarifyCurrent lives in clarifyAnswerDraft — set
  // immediately on a chip tap too (so the chip visibly confirms blue) even
  // though the actual submission is deliberately delayed a beat, see
  // clarifySubmittingRef below.
  const [clarifyQuery, setClarifyQuery] = useState("");
  const [clarifyHistory, setClarifyHistory] = useState([]);
  const [clarifyCurrent, setClarifyCurrent] = useState(null); // {question, chips} | null
  const [clarifyAnswerDraft, setClarifyAnswerDraft] = useState("");
  // Guards the brief window between a chip tap and its delayed submission
  // (see the chip's onClick below) against a second tap firing a duplicate
  // submit before clarifyBusy has actually been set — a ref rather than
  // state because it must be read/written synchronously at click time, not
  // through a setState that might not have landed yet.
  const clarifySubmittingRef = useRef(false);
  const [clarifyBusy, setClarifyBusy] = useState(false);
  const [gate, setGate] = useState(null);           // blocking search gate
  const [gateFeedback, setGateFeedback] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateFeedbackSent, setGateFeedbackSent] = useState(false);
  useEffect(() => {
    // A blocked affiliate click lands back here with ?gate=click — show the
    // same gate card in its click variant.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("gate") === "click") {
      setGate({ gate: "click" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [geoOverride, setGeoOverride] = useState("");
  const fileRef = useRef();
  const [attachment, setAttachment] = useState(null);
  // Listing ids the shopper has already watched THIS session, so the button
  // can flip to "Watching ✓" without a round trip. Not meant as the source
  // of truth (the Alerts tab reads the real list from the server) — just
  // enough to stop a double-click from firing two POSTs.
  const [watchedIds, setWatchedIds] = useState(() => new Set());
  const [watchBusyId, setWatchBusyId] = useState(null);

  const handleWatchPrice = useCallback(async (listingId) => {
    if (!listingId || watchedIds.has(listingId)) return;
    setWatchBusyId(listingId);
    try {
      const resp = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      if (resp.ok) {
        setWatchedIds((prev) => new Set(prev).add(listingId));
        trackEvent("watch_price", { listing_id: listingId });
      }
    } catch (e) {
      console.error("Watch price failed:", e);
    } finally {
      setWatchBusyId(null);
    }
  }, [watchedIds]);

  // The actual research call — unchanged except it now also sends whatever
  // clarifying-question answers the shopper gave (or [] if they skipped, or
  // clarification never triggered). Called either straight from handleSearch
  // (no questions / image search / clarify check failed) or once the
  // clarify loop below finishes (engine says done, or the shopper hits
  // "Skip — just search" mid-loop).
  const runResearch = useCallback(
    async (q, clarifications = []) => {
      const searchQ = (q || query).trim();
      if (!searchQ) return;
      if (maxSearches !== -1 && searchCount >= maxSearches) return;

      setClarifyCurrent(null);
      setClarifyHistory([]);
      setClarifyAnswerDraft("");
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
          body: JSON.stringify({ query: searchQ, attachment, geoOverride: geoOverride || undefined, locale, clarifications }),
        });

        if (resp.status === 403) {
          const g = await resp.json().catch(() => null);
          if (g?.gate === "search" || g?.gate === "upgrade") {
            setGate(g);
            return;
          }
        }
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

        // --- Streamed response: NDJSON lines from app/api/research/route.js.
        // Deliberately NOT rendered progressively (tried that; character-by-
        // character reveal read as jumpy "sections popping in"). Instead the
        // stage-grid keeps showing while "delta" lines silently accumulate,
        // and the FIRST thing actually shown is the "pick" event — the
        // product card + alternatives, which the server sends the moment
        // those specific fields finish, without waiting for candidateFitment
        // and the other admin-only fields that follow them in the same
        // response. That's the real speed win: not the typing effect, but
        // not making the shopper wait through the whole response either. At
        // that same moment the verdict text (headline etc., which the
        // schema always finishes before alternatives) is extracted from
        // what's accumulated so far and shown alongside it, as one clean,
        // complete reveal. "final" — the same fully-validated payload this
        // route has always returned — replaces it moments later.
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let rawText = "";
        let finalData = null;
        let streamError = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop(); // last (possibly partial) line stays buffered

          for (const line of lines) {
            if (!line.trim()) continue;
            let evt;
            try { evt = JSON.parse(line); } catch { continue; }

            if (evt.type === "delta") {
              rawText += evt.text; // accumulate only — no per-delta render
            } else if (evt.type === "pick") {
              clearInterval(stepTimer);
              setStep(-1);
              setProcessing(false);
              const fields = extractStreamingFields(rawText);
              setResult({
                query: searchQ,
                id: "streaming",
                ...fields,
                matchedListing: evt.matchedListing,
                alternatives: evt.alternatives || [],
                alternativesWithheld: evt.alternativesWithheld,
              });
            } else if (evt.type === "final") {
              finalData = evt;
            } else if (evt.type === "error") {
              streamError = evt;
            }
          }
        }

        if (streamError) {
          throw new Error(streamError.detail || streamError.error || "Research engine error");
        }
        if (!finalData) {
          throw new Error("Connection closed before the answer finished.");
        }
        const { type: _finalType, ...data } = finalData;
        setResult({ query: searchQ, ...data, alternatives: data.alternatives || [], id: Date.now() });
        onSearchComplete?.();
        trackEvent("search_completed", {
          matched_inventory: Boolean(data.matchedListing),
          sponsored_shown: Boolean(data.matchedListing),
        });
      } catch (e) {
        console.error(e);
        // If streaming had already started revealing a partial pick before
        // this failure, clear it — matching the pre-streaming behaviour of
        // never showing a result alongside an error banner. A half-written
        // answer next to "couldn't complete the research" reads as broken,
        // not as progress.
        setResult(null);
        setErrorMsg(
          e.message && e.message !== "Request failed"
            ? `Couldn't complete the research: ${e.message}`
            : tr("researchFailed")
        );
      }

      clearInterval(stepTimer);
      setStep(-1);
      setProcessing(false);
    },
    [query, attachment, searchCount, maxSearches, onSearchComplete]
  );

  // Fetches one round of the clarify loop and either shows the next
  // question or runs research. Shared by handleSearch (round 1, empty
  // history) and submitClarifyAnswer (subsequent rounds). Never blocks a
  // search: any failure here falls straight through to runResearch with
  // whatever's been gathered so far — same "must never prevent an answer"
  // principle the live-search arms already follow.
  const fetchClarifyStep = useCallback(
    async (searchQ, history) => {
      try {
        const resp = await fetch("/api/clarify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // geoOverride (admin-only "view as" selector) so a budget question
          // shows the right currency symbol while testing another market —
          // same value already sent to /api/research below.
          body: JSON.stringify({ query: searchQ, history, locale, geoOverride: geoOverride || undefined }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.done === false && data.question) {
            setClarifyCurrent({ question: data.question, chips: data.chips || [] });
            setClarifyAnswerDraft("");
            setProcessing(false);
            setClarifyBusy(false);
            setStep(-1);
            return;
          }
        }
      } catch (e) {
        console.error("Clarify step failed, searching with what's known:", e);
      }
      runResearch(searchQ, history);
    },
    [locale, geoOverride, runResearch]
  );

  // Button/Enter entry point. Checks whether the engine has a clarifying
  // question worth asking before committing to the full (quota-consuming)
  // research call — see app/api/clarify/route.js, which sits outside the
  // quota gate for exactly this reason.
  const handleSearch = useCallback(
    async (q) => {
      const searchQ = (q || query).trim();
      if (!searchQ) return;
      if (maxSearches !== -1 && searchCount >= maxSearches) return;

      // Image searches skip clarification entirely: phrasing a good question
      // would need vision identification run a second time (a full model
      // call, see lib/visionSearch.js), which isn't worth it for what's
      // already a fairly specific search.
      if (attachment?.data) {
        runResearch(searchQ, []);
        return;
      }

      setProcessing(true);
      setResult(null);
      setErrorMsg(null);
      setStep(0);
      setClarifyQuery(searchQ);
      setClarifyHistory([]);
      setClarifyCurrent(null);
      await fetchClarifyStep(searchQ, []);
    },
    [query, attachment, searchCount, maxSearches, fetchClarifyStep, runResearch]
  );

  // Commits an answer to the current question and immediately asks the
  // engine for the next round — no separate "Continue" step. Takes the
  // answer as an explicit argument rather than reading clarifyAnswerDraft
  // from state, so a chip tap can commit its own value in the same click
  // without a stale-closure race (setState from the same handler that
  // reads it back a line later isn't guaranteed to have landed yet).
  //
  // Deliberately does NOT clear clarifyCurrent here (that was the bug behind
  // the card flashing back to the homepage hero between rounds: with
  // clarifyCurrent briefly null and processing still false, showIdle went
  // true for one render). The card stays mounted, just visually busy, until
  // fetchClarifyStep replaces it with the next question or hands off to
  // runResearch — so there's no gap where nothing is showing.
  const submitClarifyAnswer = useCallback((answerText) => {
    if (!clarifyCurrent || clarifyBusy) return;
    const answer = (answerText || "").trim();
    if (!answer) return; // nothing typed/tapped — Skip is the way past an unanswered question
    const newHistory = [...clarifyHistory, { question: clarifyCurrent.question, answer }];
    setClarifyHistory(newHistory);
    setClarifyAnswerDraft("");
    setClarifyBusy(true);
    fetchClarifyStep(clarifyQuery, newHistory);
  }, [clarifyCurrent, clarifyBusy, clarifyHistory, clarifyQuery, fetchClarifyStep]);

  // Always available, every round: stop asking, run research with whatever
  // was already answered (an unanswered current question is simply
  // dropped, never sent as an empty answer).
  const handleClarifySkip = useCallback(() => {
    runResearch(clarifyQuery, clarifyHistory);
  }, [clarifyQuery, clarifyHistory, runResearch]);

  const quotaReached = maxSearches !== -1 && searchCount >= maxSearches;
  // Idle chrome (hero, attach button, example chips, dim stage preview)
  // hides while the Clarify card is up so the card reads as the one thing
  // to act on, not another element competing with the manifesto/hero.
  const showIdle = !result && !processing && !clarifyCurrent;

  return (
    <div>
      {showIdle && (
        // Reserved height (2026-08-20): the two manifesto statements wrap to
        // different numbers of lines, especially on narrow screens (variant
        // 0's longer body vs. variant 1's shorter one measured up to an 82px
        // difference at 375px wide). Without a fixed floor, every 5s
        // rotation reflowed everything below it, including the search bar —
        // exactly the shift a shopper mid-typing would feel as the box
        // jumping under their cursor. The clamp() below was fitted against
        // real measurements at 320/360/375/414/480/780+px (see the rendered
        // heights checked via the Browser tool) so the hero's OUTER height
        // never changes between variants at any of them, decoupling the
        // search bar's position from which statement happens to be showing.
        <div style={{ textAlign: "center", padding: "18px 0 8px", minHeight: "clamp(200px, 400px - 30vw, 320px)", display: "flex", flexDirection: "column", justifyContent: "center", boxSizing: "border-box" }}>
          <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 16px", lineHeight: 1.1, color: "#14161A" }}>
            {MANIFESTO[manifestoIdx].plain[0]}
            {MANIFESTO[manifestoIdx].colored.map((w, i) => (
              <span key={w} style={{ color: GRADIENT_COLORS[i % GRADIENT_COLORS.length] }}> {w}</span>
            ))}
            {MANIFESTO[manifestoIdx].trail}
          </h1>
          <p style={{ fontSize: 15, color: "var(--color-text-secondary)", margin: "0 auto", lineHeight: 1.7, maxWidth: 560 }}>
            {MANIFESTO[manifestoIdx].body}
          </p>
          {/* Manifesto progress dots — click to jump, same idea as the pair
              on searchllm.ai, sized for a two-statement rotation. */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "14px 0 4px" }}>
            {MANIFESTO.map((m, i) => (
              <button
                key={m.trail + i}
                onClick={() => setManifestoIdx(i)}
                aria-label={`Statement ${i + 1}`}
                style={{ width: 28, height: 3, borderRadius: 2, border: "none", cursor: "pointer", background: i === manifestoIdx ? "#4F46E5" : "var(--color-border-tertiary)", padding: 0 }}
              />
            ))}
          </div>
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

      {showIdle && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <button onClick={() => fileRef.current?.click()} style={{ background: "#fff", border: "0.5px solid var(--color-border-secondary)", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontSize: 13, color: attachment ? "#0F6E56" : "var(--color-text-secondary)", boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
            {attachment ? (attachment.preparing ? tr("reading") : attachment.name) : tr("attach")}
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
          {attachment && <button onClick={() => setAttachment(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#D85A30", marginLeft: 8 }}>✕</button>}
        </div>
      )}

      {/* The big rounded search bar — the one element that's always visible,
          idle or not, so a shopper can immediately ask a follow-up. */}
      <div className="sllm-search-actions sllm-searchbar" style={{ background: "#fff", borderRadius: 16, border: "0.5px solid var(--color-border-tertiary)", boxShadow: "0 2px 10px rgba(16,24,40,0.06)", padding: "16px 16px 16px 22px", marginBottom: 16, display: "flex", alignItems: "flex-end", gap: 12 }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSearch(); }}
          placeholder={result || processing ? `e.g. ${PLACEHOLDER_EXAMPLES[placeholderIdx]}` : "What are you shopping for?"}
          rows={1}
          style={{ flex: "1 1 160px", minWidth: 0, boxSizing: "border-box", border: "none", background: "transparent", fontSize: 16, resize: "none", outline: "none", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", lineHeight: 1.6, padding: "8px 0" }}
        />
        {/* Ctrl+Enter only means anything with a physical keyboard — hidden
            on touch/narrow screens via .sllm-ctrl-hint in globals.css rather
            than crowding the search button off a 360px row. */}
        <span className="sllm-ctrl-hint" style={{ fontSize: 10, color: "var(--color-text-tertiary)", whiteSpace: "nowrap", marginBottom: 14 }}>Ctrl+Enter</span>
        <button
          onClick={() => handleSearch()}
          disabled={processing || !query.trim() || quotaReached}
          className="sllm-primary-btn"
          style={{ background: processing || !query.trim() ? "var(--color-background-tertiary)" : "#3F3F46", color: processing || !query.trim() ? "var(--color-text-tertiary)" : "#fff", border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {processing ? "Researching…" : "Search"}
        </button>
      </div>
      {/* Attach-file placement moves above the bar on mobile too (see
          globals.css) — everything else about that block is unchanged. */}

      {showIdle && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 22 }}>
          {CHIP_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="sllm-example-chip"
              style={{ background: "none", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 14, padding: "5px 11px", fontSize: 12, color: "var(--color-text-tertiary)", cursor: "pointer", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {errorMsg && (
        <div style={{ background: "#D85A3011", border: "1px solid #D85A3044", borderRadius: 9, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#D85A30" }}>
          {errorMsg}
        </div>
      )}

      {/* Four-column physics-themed process trace. Idle: a dim preview of
          the stages a search will run through. Processing: the live one,
          each column's bar filling and label brightening as `step` advances
          — same visual language, so nothing jarring swaps in when a search
          actually starts. */}
      {(processing || (!result && !clarifyCurrent)) && (
        <div className="sllm-stage-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 18, padding: processing ? "12px 4px 26px" : "0 4px 26px", opacity: processing ? 1 : 0.55 }}>
          {STAGE_LABELS.map((label, i) => {
            const active = processing && step >= i;
            const current = processing && step === i;
            return (
              <div key={label}>
                <div style={{ height: 3, borderRadius: 2, background: "var(--color-border-tertiary)", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: active ? "100%" : "0%", background: "#4F46E5", transition: "width 0.6s ease", opacity: current ? 0.7 : 1 }} />
                </div>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, letterSpacing: "0.08em", color: active ? "#4F46E5" : "var(--color-text-tertiary)" }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)", marginTop: 2 }}>
                  {STEPS[i]}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pre-research clarifying loop (bosonic layer) — one question per
          round from /api/clarify, see fetchClarifyStep/submitClarifyAnswer
          above. No separate "Continue" step: tapping a chip commits it and
          immediately advances; typing a custom answer and pressing Enter
          does the same. "Skip — just search" is the always-available way
          past a question without answering it, at any round. */}
      {clarifyCurrent && !processing && (
        <div style={{ border: "0.5px solid #C7D2E0", background: "#F5F7FB", borderRadius: 12, padding: "16px 18px", margin: "14px 0" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#3F3F46", marginBottom: 12 }}>
            {tr("clarifyHeading")}
          </div>
          <div style={{ marginBottom: 12, opacity: clarifyBusy ? 0.5 : 1, transition: "opacity 0.15s ease" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 8 }}>
              {clarifyCurrent.question}
            </div>
            {clarifyCurrent.chips?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {clarifyCurrent.chips.map((chip) => {
                  const selected = clarifyAnswerDraft === chip;
                  return (
                    <button
                      key={chip}
                      disabled={clarifyBusy}
                      onClick={() => {
                        // Confirm-then-advance: show the tap registered
                        // (chip turns blue) before moving on, rather than
                        // jumping straight to the next question/search with
                        // no visible acknowledgement of what was picked.
                        if (clarifyBusy || clarifySubmittingRef.current) return;
                        clarifySubmittingRef.current = true;
                        setClarifyAnswerDraft(chip);
                        setTimeout(() => {
                          clarifySubmittingRef.current = false;
                          submitClarifyAnswer(chip);
                        }, 220);
                      }}
                      style={{
                        background: selected ? "#4F46E5" : "#fff",
                        color: selected ? "#fff" : "var(--color-text-secondary)",
                        border: `0.5px solid ${selected ? "#4F46E5" : "var(--color-border-secondary)"}`,
                        borderRadius: 14,
                        padding: "6px 13px",
                        fontSize: 12,
                        cursor: clarifyBusy ? "default" : "pointer",
                        transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
                      }}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={clarifyAnswerDraft}
              onChange={(e) => setClarifyAnswerDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitClarifyAnswer(clarifyAnswerDraft); } }}
              // Just the base placeholder, not "(Enter to submit)" tacked on
              // — that got clipped on a 375px phone screen with no ellipsis
              // (caught via a live mobile check against production, 2026-08-20:
              // "or type your own answer… (Enter to s"). Chips are the
              // primary path; Enter-to-submit on a text input is a common
              // enough convention not to need an explicit, truncation-prone
              // callout in the placeholder itself.
              placeholder={tr("clarifyCustomPlaceholder")}
              disabled={clarifyBusy}
              style={{ width: "100%", boxSizing: "border-box", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 10px", fontSize: 12, background: "#fff", color: "var(--color-text-primary)" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <button
              onClick={handleClarifySkip}
              style={{ background: "none", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}
            >
              {tr("skipJustSearch")}
            </button>
            {clarifyBusy && <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>…</span>}
          </div>
        </div>
      )}

      {gate && gate.gate === "upgrade" && (
        <div style={{ border: "0.5px solid #C9DED6", background: "#F2F8F6", borderRadius: 12, padding: "16px 18px", margin: "14px 0" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F6E56", marginBottom: 6 }}>
            You&apos;re getting real value here — help keep it honest
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            {gate.message}
          </div>
          <div className="sllm-gate-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {gate.signedIn ? (
              <a href="/?upgrade=1" style={{ background: "#0F6E56", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
                Upgrade to Plus — {planPriceLabel()}
              </a>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, color: "#0F6E56" }}>Sign in (top right) to upgrade — your points come with you.</span>
            )}
            <button
              disabled={gateBusy}
              onClick={async () => {
                setGateBusy(true);
                try {
                  await fetch("/api/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "prompt" }) });
                  setGate(null);
                  handleSearch();
                } finally { setGateBusy(false); }
              }}
              style={{ background: "none", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
            >
              Continue for now
            </button>
          </div>
        </div>
      )}
      {gate && gate.gate !== "upgrade" && (
        <div style={{ border: "0.5px solid #EADFC8", background: "#FDF8EF", borderRadius: 12, padding: "16px 18px", margin: "14px 0" }}>
          {!gateFeedbackSent ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#854F0B", marginBottom: 6 }}>
                {gate.gate === "click" ? "Product links paused — a word before we continue" : `${gate.searches} picks since your last purchase — a word before we continue`}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
                {gate.gate === "click"
                  ? <>You&apos;ve opened your full allowance of recommended product links since your last purchase. To keep browsing stores through us, use <strong>Increase Usage</strong> — and if you have a moment, tell us what stopped you at the store pages. We read every word.</>
                  : <>Every pick runs real AI research and costs us real server money. To keep going, use <strong>Increase Usage</strong> below — and if you have a moment, tell us what&apos;s kept you from shopping through a recommendation. We read every word.</>}
              </div>
              <textarea
                value={gateFeedback}
                onChange={(e) => setGateFeedback(e.target.value)}
                placeholder="optional, but genuinely valued — e.g. prices were higher on the store page…"
                rows={2}
                style={{ width: "100%", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "none", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box" }}
              />
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
              🙏 Your feedback is gratefully acknowledged — it genuinely shapes what we build. We do incur server costs for every pick, so to continue, please use Increase Usage. You&apos;ve used the platform a lot, and we deeply appreciate your continued support.
            </div>
          )}
          <div className="sllm-gate-actions" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              disabled={gateBusy}
              onClick={async () => {
                setGateBusy(true);
                try {
                  const resp = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "recharge" }) });
                  const j = await resp.json();
                  if (j.url) window.location.href = j.url;
                } finally { setGateBusy(false); }
              }}
              style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: gateBusy ? 0.5 : 1 }}
            >
              Increase Usage — ₹249 for 50 picks
            </button>
            {!gateFeedbackSent && (
              <button
                disabled={gateBusy || gateFeedback.trim().length < 3}
                onClick={async () => {
                  setGateBusy(true);
                  try {
                    const resp = await fetch("/api/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: gate.gate === "click" ? "click" : "search", feedback: gateFeedback }) });
                    if (resp.ok) setGateFeedbackSent(true);
                  } finally { setGateBusy(false); }
                }}
                style={{ background: "none", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: gateBusy || gateFeedback.trim().length < 3 ? 0.5 : 1 }}
              >
                Send feedback
              </button>
            )}
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Shopping through any recommendation also resets your free picks.</span>
          </div>
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
              {result.confidence && <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{tr("confidence")}: {result.confidence}</span>}
            </div>
            {result.imageUnderstanding && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", background: "var(--color-background-tertiary)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                {tr("fromPhoto")} {result.imageUnderstanding}
              </div>
            )}
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 10, lineHeight: 1.4 }}>{result.headline}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>{result.reasoning}</div>
            {result.whoItsFor && <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}><strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{tr("goodFor")}</strong> {result.whoItsFor}</div>}
            {result.whoShouldSkip && <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}><strong style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{tr("skipIf")}</strong> {result.whoShouldSkip}</div>}
          </div>

          {/* Admin-only matcher transparency: what was offered to the model
              and what it chose. Present only when the API included it (it
              never does for regular users). Turns "why is there no card"
              into a glance instead of a debugging session. */}
          {result.sponsoredDebug && (
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-secondary)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
              <strong style={{ fontWeight: 500 }}>Admin — matcher:</strong>{" "}
              {result.sponsoredDebug.offered.length === 0
                ? "no inventory candidates cleared the retrieval gate (score ≥2 after budget/geo filters)."
                : `offered ${result.sponsoredDebug.offered.length}: ${result.sponsoredDebug.offered
                    .map((o) => `${o.product.slice(0, 40)} (${o.price}, s${o.score})`)
                    .join(" · ")} → model chose ${
                    result.sponsoredDebug.chosenId
                      ? `#${result.sponsoredDebug.chosenId}`
                      : "none (judged not genuinely suitable)"
                  }`}
            </div>
          )}
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
                    {result.matchedListing.brand}
                    {/* Real shopper ratings from the feed — shown because they're
                        genuinely useful, and because they're the reason this
                        product was chosen over other equally relevant ones. */}
                    {result.matchedListing.rating != null && (
                      <span style={{ marginLeft: 6 }}>
                        · ★ {result.matchedListing.rating}
                        {result.matchedListing.ratingCount
                          ? ` (${Number(result.matchedListing.ratingCount).toLocaleString()})`
                          : ""}
                      </span>
                    )}
                    {result.matchedListing.pitch ? ` · ${result.matchedListing.pitch}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <a
                      href={`/out/${result.matchedListing.id}?ctx=research`}
                  onClick={() => trackEvent("affiliate_click", { listing_id: result.matchedListing.id, network: result.matchedListing.network })}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      style={{ display: "inline-block", fontSize: 13, fontWeight: 500, color: "#fff", background: "#854F0B", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
                      {/* The link goes through /out/, which records the click
                          server-side (replacing the old sendBeacon — blockers
                          eat beacons, they don't eat navigations), mints the
                          click_id for conversion attribution, and 302s to the
                          tracked network link. */}
                      {result.matchedListing.merchantDomain
                        ? `View on ${result.matchedListing.merchantDomain} →`
                        : "View and buy →"}
                    </a>
                    {/* Notifies on a genuine drop (3%+, or the shopper's own
                        target) via the hourly price-check cron — see
                        lib/priceAlerts.js. Deliberately its own button, not
                        folded into "save pick": saving is a note to self,
                        watching is asking to be interrupted later. */}
                    <button
                      onClick={() => handleWatchPrice(result.matchedListing.id)}
                      disabled={watchBusyId === result.matchedListing.id || watchedIds.has(result.matchedListing.id)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500,
                        color: watchedIds.has(result.matchedListing.id) ? "#0F6E56" : "#854F0B",
                        background: "transparent", border: `0.5px solid ${watchedIds.has(result.matchedListing.id) ? "#0F6E5666" : "#854F0B66"}`,
                        padding: "7px 14px", borderRadius: 8, cursor: watchedIds.has(result.matchedListing.id) ? "default" : "pointer",
                      }}>
                      {watchedIds.has(result.matchedListing.id)
                        ? "🔔 Watching"
                        : watchBusyId === result.matchedListing.id
                        ? "…"
                        : "🔔 Watch price"}
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 8 }}>This never changes the price you pay, and it&apos;s never the reason this option was suggested — see alternatives below.</div>
            </div>
          )}

          {/* Model-suggested refinement chips: one tap appends the phrase to
              the query and re-runs. This is the honest version of a filter
              dropdown — structure offered as a follow-up, never a gate, and
              suggested by the model with full context of THIS question. */}
          {/* Points earned message — the retention loop made visible. Guests
              see the day-expiring figure with the signup nudge; users see
              earned-this-pick and today's running total. */}
          {result.rewards && (
            <div style={{ fontSize: 12, color: "#854F0B", background: "#FDF8EF", border: "0.5px solid #EADFC8", borderRadius: 8, padding: "8px 12px", margin: "10px 0" }}>
              {result.rewards.kind === "user" ? (
                result.rewards.earned > 0 ? (
                  <>✨ You earned <strong>{result.rewards.earned} points</strong> for this pick — {result.rewards.todayTotal} today. Clicking a recommended product link earns {LOYALTY.SEARCH_POINTS.CLICK_POINTS} more. <a href="/points" style={{ color: "#854F0B", textDecoration: "underline" }}>How points work</a></>
                ) : (
                  <>You&apos;ve reached the {LOYALTY.ENGAGEMENT_POINTS_LIFETIME_CAP}-point maximum for searching and clicking. Points from confirmed purchases have no limit and keep adding up. <a href="/points" style={{ color: "#854F0B", textDecoration: "underline" }}>How points work</a></>
                )
              ) : (
                <>✨ You&apos;ve earned <strong>{result.rewards.guestToday} points</strong> today as a guest — they expire at midnight. <strong>Sign up free to keep them</strong>, and they&apos;ll keep adding up.</>
              )}
            </div>
          )}
          {result.refinements?.length > 0 && !processing && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Sharpen this pick:</span>
              {result.refinements.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const refined = `${result.query} ${r}`.replace(/\s+/g, " ").trim();
                    setQuery(refined);
                    handleSearch(refined);
                  }}
                  style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 12, padding: "4px 11px", fontSize: 12, color: "#0F6E56", cursor: "pointer" }}
                >
                  ＋ {r}
                </button>
              ))}
            </div>
          )}
          {result.amazonBrowse && (
            <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, margin: "12px 0", overflow: "hidden" }}>
              <div className="sllm-amazon-row" style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 3 }}>
                    Not in our partner inventory — available on Amazon
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {result.amazonBrowse.term}
                  </div>
                </div>
                <a
                  href={result.amazonBrowse.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  onClick={() => trackEvent("amazon_browse_click", {})}
                  style={{ background: "#FF9900", color: "#111", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  Browse on Amazon ↗
                </a>
              </div>
              <div style={{ padding: "7px 14px", background: "var(--color-background-secondary)", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                Partner link — as an Amazon Associate, we earn from qualifying purchases. Your price never changes, and our answer above was written without knowing this link would appear.
              </div>
            </div>
          )}
          {result.alternativesWithheld && (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "12px 14px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, margin: "10px 0", lineHeight: 1.7 }}>
              Alternative suggestions are paused on your account — you&apos;ve used your full cycle allowance without a purchase. Your research and recommendations continue as normal.
              {/* Plus members are never blocked from researching, so this is
                  an option rather than a wall: a purchase restores the
                  suggestions free, Increase Usage restores them now. */}
              <div className="sllm-gate-actions" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  disabled={gateBusy}
                  onClick={async () => {
                    setGateBusy(true);
                    try {
                      const resp = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "recharge" }) });
                      const j = await resp.json();
                      if (j.url) window.location.href = j.url;
                    } finally { setGateBusy(false); }
                  }}
                  style={{ background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", opacity: gateBusy ? 0.5 : 1 }}
                >
                  Increase Usage — ₹{LOYALTY.RECHARGE_PRICE_INR} to restore them
                </button>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  Or complete a purchase through any recommendation — that restores them free.
                </span>
              </div>
            </div>
          )}
          {result.alternatives?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                We also considered — chosen by the AI with no knowledge of what we earn. These links go to Amazon and may earn us a commission; your price never changes. Any prices shown are rough estimates, not live.</div>
              {result.alternatives.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                  <div>
                    {/* Tracked but NEVER monetized: /alt records the click as
                        brand-demand evidence, then opens a neutral web search.
                        The moment these earn money, the section stops being
                        proof that advice comes first. */}
                    <a
                      onClick={() => trackEvent("alternative_click", {})}
                      href={`/alt?p=${encodeURIComponent(a.name || "")}&ctx=research`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", textDecoration: "underline", textDecorationColor: "var(--color-border-secondary)", textUnderlineOffset: 3 }}
                    >
                      {a.name} ↗
                    </a>
                    <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{a.note}</div>
                  </div>
                  {/* Deliberately lighter than the sponsored card's price:
                      that one comes from the partner feed and is real; this
                      one is the model's recollection. Same styling would
                      imply the same reliability. */}
                  {a.price ? (
                    <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", whiteSpace: "nowrap", marginLeft: 12 }}>
                      ~{a.price}<span style={{ fontSize: 10 }}> est.</span>
                    </div>
                  ) : null}
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
                  {isSaved ? tr("saved") : tr("savePick")}
                </button>
              );
            })()}
            <button onClick={() => { setResult(null); setQuery(""); setAttachment(null); }} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>{tr("newQuestion")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
