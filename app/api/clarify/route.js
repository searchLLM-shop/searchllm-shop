// app/api/clarify/route.js
//
// Pre-flight step, called before /api/research. Deliberately outside the
// quota/lifecycle gate in app/api/research/route.js — asking (or skipping)
// a clarifying question must never cost a shopper a pick, so this route
// does no quota check, no listing search, no live web search, and no
// Anthropic call beyond the one cheap Haiku pass in lib/clarify.js.
//
// Content-filtered exactly like /api/research: a restricted query must
// never reach the question-generation model either.

import { checkQuery } from "@/lib/contentFilter";
import { generateClarifyingQuestions } from "@/lib/clarify";

export async function POST(req) {
  try {
    const { query, locale, geoOverride } = await req.json();

    const contentCheck = checkQuery(query);
    if (contentCheck.blocked) {
      return Response.json({ error: contentCheck.reason }, { status: 400 });
    }
    if (!query || typeof query !== "string" || !query.trim()) {
      return Response.json({ error: "Missing query" }, { status: 400 });
    }

    // Same geo signal app/api/research/route.js uses, so a budget question
    // shows ₹ for an Indian shopper and $ elsewhere — only used here to pick
    // a currency symbol, so (unlike research's admin-only override) it's
    // fine to trust the client value directly: worst case is a cosmetically
    // wrong symbol on a question, not an actual geo-restricted offer leaking.
    const country =
      geoOverride || req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || null;

    // Never a hard failure beyond the content-filter block above: any model
    // or parse error degrades to "no clarifying question", exactly like
    // extractIntent()'s failure mode in the main research route.
    const questions = (await generateClarifyingQuestions(query, locale, country).catch((err) => {
      console.error("Clarify route: generation threw:", err.message);
      return null;
    })) || [];

    return Response.json({ questions });
  } catch (err) {
    console.error("Clarify route error:", err);
    // Even a totally unexpected failure here should read as "no question
    // available" to the frontend, not an error state — clarification is
    // strictly optional and must never block a search.
    return Response.json({ questions: [] });
  }
}
