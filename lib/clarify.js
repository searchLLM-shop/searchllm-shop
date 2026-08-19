// lib/clarify.js
//
// Iterative pre-research clarifying loop. One question at a time, BEFORE
// research runs, so answers shape both retrieval (via
// lib/queryIntent.js's retrievalTerms/contextQuery/priceQuery once folded
// into intentSource) and synthesis (via the clarificationContext block in
// app/api/research/route.js). This file only decides what to ask NEXT and
// whether enough is known — nothing here runs retrieval or synthesis.
//
// Two dimensions the model pursues, in whatever order matters most for a
// given query:
//   1. The ask itself — missing hard requirements (budget, attribute, use).
//   2. The shopper's PERCEPTION of the product — why they want it, how/when
//      they'll use it, what outcome or value they expect from it. Earlier
//      versions of this file only ever chased (1); this is what makes the
//      bosonic layer actually understand the person, not just the request.
// The model keeps asking, one question per round, until it judges BOTH
// dimensions are sufficiently understood — never capped at a fixed count of
// questions by design, only by its own judgment plus the defensive round
// cap below.
//
// Same contract as extractIntent() on purpose: Haiku, cheap, temperature 0,
// never throws, failure returns null so the caller (app/api/clarify/route.js)
// can fall back to "done" and proceed straight to research. Sits BEFORE the
// quota gate, so it must stay cheap and must never be able to block a
// search — the shopper's own "Skip — just search" button is the real limit
// on how many questions get asked; this file has no say over that, it only
// decides what the NEXT question would be if one is asked.

import { languageForModel } from "@/lib/i18n";

// Purely an engineering backstop against a runaway loop (a prompt quirk that
// always says "not done yet") — NOT a product cap. A well-behaved model
// should rarely reach this on its own; it's steered to wrap up as it
// approaches it (see the round note built below). Lowered from 6 to 4
// (2026-08-19): every round is a full network round trip the shopper waits
// through before research even starts, and real shopping questions almost
// never need more than 1-2 good questions — the model is now steered to
// treat that as the norm, not just the ceiling.
const MAX_ROUNDS = 4;

const CLARIFY_PROMPT = `You are deciding the SINGLE most useful next question to ask a shopper before researching their product question — or deciding you already know enough.

You are pursuing TWO things, not one:
1. THE ASK — missing hard requirements: budget, a defining attribute (colour, size, material, capacity, formulation), intended use, anything the right product depends on.
2. THEIR PERCEPTION OF THE PRODUCT — why they actually want it, how and when they'll use it, and what outcome or value they expect to get out of it. A person buying "running shoes" might want daily fitness, marathon training, or just something comfortable for errands — the right product differs completely, and this is usually NOT stated in the original query.

Every round is a real wait for the shopper — be decisive, not thorough for its own sake. You will be given the original query and, possibly, a history of questions already asked and answered this session. Decide:
- Ask ONE more short question ONLY when the single most useful missing thing would plausibly change which product is right — not because a dimension is merely unexplored. Never repeat a question already asked (see history). Never ask about something the query or a prior answer already covers.
- When in doubt, declare done rather than asking. Both dimensions being theoretically explorable further is normal and not, by itself, a reason to keep going.

Rules for the question itself:
- Under 8 words, phrased naturally, like a knowledgeable friend asking one thing before helping — not a form field label.
- 3-4 short (1-4 words each), concrete, mutually exclusive tap-to-answer chip suggestions, covering a sensible spread for the category.
- Never ask something that couldn't plausibly change the recommendation.
- The default is ONE good question, occasionally a second when the first answer reveals something else genuinely critical is still missing. A third is rare and should only happen when the query is unusually underspecified. Many queries — especially ones that already state a clear product, budget or use — need zero.

Respond with ONLY valid JSON, no markdown fences:
{
  "done": true or false,
  "question": "short question, under 8 words — omit or empty string if done is true",
  "chips": ["short answer", "short answer", "short answer"]
}`;

function buildHistoryBlock(query, history) {
  const lines = [`Original query: ${query}`];
  if (history.length) {
    lines.push("", "Already asked and answered this session:");
    history.forEach((h, i) => lines.push(`${i + 1}. Q: ${h.question}  A: ${h.answer}`));
  }
  return lines.join("\n");
}

// history: [{question, answer}], oldest first, already sanitized by the
// caller (see safeHistory in app/api/clarify/route.js).
export async function nextClarifyingStep(query, history, locale, country) {
  if (!query || typeof query !== "string" || query.trim().length < 3) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const safeHistory = Array.isArray(history) ? history : [];
  const round = safeHistory.length + 1;

  // Hard backstop: zero cost, no model call once the defensive cap is hit.
  if (round > MAX_ROUNDS) return { done: true };

  const language = languageForModel(locale);
  const currency = String(country || "").toUpperCase() === "IN" ? "₹" : "$";
  const currencyNote = `\n\nIf your question or its chips involve a price or budget, use the currency symbol ${currency} for every figure (e.g. "${currency}500-1000") — never a different symbol or "Rs"/"USD" spelled out.`;
  // Calibrated to the tightened default above: a gentle nudge from round 2
  // (the default is ONE question), a strong one from round 3 onward.
  const roundNote =
    round >= 3
      ? `\n\nThis is round ${round} of this conversation — already more than the norm. Declare done unless something genuinely critical is still unknown.`
      : round === 2
      ? `\n\nThis is round 2. Only ask again if the first answer revealed something else that would genuinely change the pick — otherwise declare done.`
      : "";
  const system =
    (language === "English"
      ? CLARIFY_PROMPT
      : `${CLARIFY_PROMPT}\n\nWrite the question and the chips in ${language} — the shopper reads ${language}, not English.`) +
    currencyNote +
    roundNote;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        temperature: 0, // reproducible: the same state shouldn't ask a different question on a retry
        system,
        messages: [{ role: "user", content: buildHistoryBlock(query, safeHistory).slice(0, 2000) }],
      }),
    });
    if (!resp.ok) throw new Error(`clarify ${resp.status}`);
    const data = await resp.json();
    let raw = (data.content?.[0]?.text || "").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(raw);

    if (parsed.done === true) return { done: true };

    const question = typeof parsed.question === "string" ? parsed.question.trim().slice(0, 120) : "";
    if (!question) return { done: true }; // model said not-done but gave nothing to ask — treat as done rather than showing an empty card

    const chips = Array.isArray(parsed.chips)
      ? parsed.chips.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim().slice(0, 40)).slice(0, 4)
      : [];

    return { done: false, question, chips };
  } catch (err) {
    // Clarification is an improvement, never a dependency — the caller falls
    // back to running research with no further clarifying step.
    console.error("Clarifying-step generation failed, skipping:", err.message);
    return null;
  }
}
