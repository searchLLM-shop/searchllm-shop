// app/api/clarify/route.js
//
// Pre-flight step, called before /api/research — once per round of the
// iterative clarify loop. Deliberately outside the quota/lifecycle gate in
// app/api/research/route.js — asking (or skipping) a clarifying question
// must never cost a shopper a pick, so this route does no quota check, no
// listing search, no live web search, and no Anthropic call beyond the one
// cheap Haiku pass in lib/clarify.js.
//
// Content-filtered exactly like /api/research: a restricted query must
// never reach the question-generation model either.

import { checkQuery } from "@/lib/contentFilter";
import { nextClarifyingStep } from "@/lib/clarify";

// Defensive cap matching lib/clarify.js's own backstop — belt and braces
// against a malformed/huge client payload, not a product limit (the
// shopper's real limit is "Skip — just search", available every round).
const MAX_HISTORY = 8;

export async function POST(req) {
  try {
    const { query, history, locale, geoOverride } = await req.json();

    const contentCheck = checkQuery(query);
    if (contentCheck.blocked) {
      return Response.json({ error: contentCheck.reason }, { status: 400 });
    }
    if (!query || typeof query !== "string" || !query.trim()) {
      return Response.json({ error: "Missing query" }, { status: 400 });
    }
    // Length cap (2026-08-25 security review) — this route has NO quota
    // gate at all by design (see file header), which makes an unbounded
    // query string here a bigger cost-abuse exposure than the same gap in
    // /api/research, not a smaller one: nothing stops repeated calls, each
    // one able to carry an arbitrarily large string into a paid model call.
    if (query.length > 500) {
      return Response.json({ error: "That question is too long — try summarising it in a sentence or two." }, { status: 400 });
    }

    // Re-validated here rather than trusted from the client: only strings,
    // capped in count and length — same posture as safeClarifications in
    // app/api/research/route.js, since this is the same kind of free-text
    // input eventually reaching a model prompt.
    const safeHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.question === "string" && typeof h.answer === "string" && h.answer.trim())
          .slice(0, MAX_HISTORY)
          .map((h) => ({
            question: h.question.trim().slice(0, 120),
            answer: h.answer.trim().slice(0, 200),
          }))
      : [];

    // Same geo signal app/api/research/route.js uses, so a budget question
    // shows ₹ for an Indian shopper and $ elsewhere — only used here to pick
    // a currency symbol, so (unlike research's admin-only override) it's
    // fine to trust the client value directly: worst case is a cosmetically
    // wrong symbol on a question, not an actual geo-restricted offer leaking.
    const country =
      geoOverride || req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || null;

    // Never a hard failure beyond the content-filter block above: any model
    // or parse error degrades to "done" (no further question), exactly like
    // extractIntent()'s failure mode in the main research route.
    const step = (await nextClarifyingStep(query, safeHistory, locale, country).catch((err) => {
      console.error("Clarify route: generation threw:", err.message);
      return null;
    })) || { done: true };

    return Response.json(step);
  } catch (err) {
    console.error("Clarify route error:", err);
    // Even a totally unexpected failure here should read as "done" to the
    // frontend, not an error state — clarification is strictly optional and
    // must never block a search.
    return Response.json({ done: true });
  }
}
