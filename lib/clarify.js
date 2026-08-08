// lib/clarify.js
//
// Asks the shopper one (rarely two) quick clarifying question BEFORE
// research runs, so the answer can shape both retrieval (via
// lib/queryIntent.js's retrievalTerms/contextQuery/priceQuery, once the
// answer is folded into intentSource) and synthesis (via a context block
// appended directly to the answering model's prompt in
// app/api/research/route.js). Neither of those things happens here — this
// file only decides WHAT to ask.
//
// Same contract as extractIntent() in lib/queryIntent.js on purpose: Haiku,
// cheap, temperature 0, never throws, failure returns null so the caller can
// skip straight to research. This step sits BEFORE the quota gate in
// app/api/clarify/route.js, so it must stay cheap and must never be able to
// block a search — only add to it when it has something useful to ask.

import { languageForModel } from "@/lib/i18n";

const CLARIFY_PROMPT = `You write ONE short clarifying question (occasionally two, never more) to ask a shopper before researching their product question, plus 3-4 short tap-to-answer suggestions for it.

Rules:
- Ask about whatever missing piece of information would most change which product is right — usually budget, a defining attribute (colour, size, material, capacity, formulation), or intended use. Never ask about something the query already states.
- If the query already gives a budget, don't ask about budget again — ask about something else that's still missing, or return zero questions if there's genuinely nothing left worth asking.
- Keep the question itself under 8 words, phrased naturally, like a knowledgeable friend asking one thing before helping — not a form field label.
- Chips are short (1-4 words each), concrete, mutually exclusive answers a shopper could tap instead of typing, covering a sensible spread for the category (e.g. for a budget question: a low, mid and high band that actually make sense for that product type).
- Return exactly 1 question ordinarily. Return 2 only when two genuinely different, equally important things are missing (e.g. both budget AND a hard attribute like size). Never return more than 2.
- Return an empty array ONLY when the query already states enough for a good recommendation (a clear product type plus a budget or a defining attribute) — this should be rare; most real shopping questions benefit from one clarifying question.
- Never ask something unrelated to the purchase decision ("what's your favorite color" when color doesn't matter to this product) — every question must be something that could plausibly change the recommendation.

Respond with ONLY valid JSON, no markdown fences:
{
  "questions": [
    { "question": "short question, under 8 words", "chips": ["short answer", "short answer", "short answer"] }
  ]
}`;

export async function generateClarifyingQuestions(query, locale) {
  if (!query || typeof query !== "string" || query.trim().length < 3) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const language = languageForModel(locale);
  const system =
    language === "English"
      ? CLARIFY_PROMPT
      : `${CLARIFY_PROMPT}\n\nWrite the question and the chips in ${language} — the shopper reads ${language}, not English.`;

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
        temperature: 0,          // reproducible: the same query shouldn't ask a different question on a retry
        system,
        messages: [{ role: "user", content: query.slice(0, 400) }],
      }),
    });
    if (!resp.ok) throw new Error(`clarify ${resp.status}`);
    const data = await resp.json();
    let raw = (data.content?.[0]?.text || "").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(raw);

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .filter((q) => q && typeof q.question === "string" && q.question.trim())
          .slice(0, 2)
          .map((q) => ({
            question: q.question.trim().slice(0, 120),
            chips: Array.isArray(q.chips)
              ? q.chips.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim().slice(0, 40)).slice(0, 4)
              : [],
          }))
      : [];

    return questions;
  } catch (err) {
    // Clarification is an improvement, never a dependency — the caller falls
    // back to running research with no clarifying step at all.
    console.error("Clarifying-question generation failed, skipping:", err.message);
    return null;
  }
}
