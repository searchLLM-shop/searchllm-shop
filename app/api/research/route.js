// app/api/research/route.js
//
// This route replaces the direct browser-to-Anthropic fetch() call from the
// prototype. The API key lives only here, on the server, and is never sent
// to the client. Listing matching also happens here, server-side, against
// the real approved-listings table instead of in-memory React state.

import { auth } from "@clerk/nextjs/server";
import { getApprovedListings, insertMicrosite, getAndIncrementUsage, getUsageToday, getUserPlan } from "@/lib/db";
import { findMatchingListing, buildClientListingPayload } from "@/lib/listingMatcher";
import { getOrCreateGuestId } from "@/lib/guestId";
import { PLANS } from "@/lib/constants";
import { shouldSearch, braveSearch, formatSearchContext } from "@/lib/braveSearch";

const SYSTEM_PROMPT = `You are SearchLLM, a shopping research assistant whose entire reputation rests on being honest, not on maximizing affiliate revenue. Given a shopping question, produce a single clear recommendation with real reasoning — trade-offs, who it's for, who should skip it. Be specific and a little opinionated, like a knowledgeable friend, not a generic listicle. You may sometimes receive current web search results as additional context — use them for anything time-sensitive (current prices, availability, newest releases), but still reason independently rather than just repeating them. Respond ONLY with valid JSON:
{
  "headline": "one sentence framing of the actual decision the person is making",
  "reasoning": "2-4 sentences of real trade-off reasoning, specific, not generic marketing language",
  "whoItsFor": "one sentence",
  "whoShouldSkip": "one sentence",
  "confidence": "high|medium|low",
  "alternatives": [{"name": "a real alternative product relevant to THIS query", "note": "one short phrase on the trade-off vs the pick", "price": "approx price or empty string"}],
  "micrositeTitle": "short title for the knowledge microsite",
  "micrositeSummary": "1-2 sentence anonymized summary",
  "taskType": "research|creative|technical|predictive|analysis",
  "learnings": ["short reusable knowledge fragment", "another one", "a third"]
}
Provide 2-3 alternatives that are genuinely relevant to the specific product the person asked about — never generic or unrelated items.`;

export async function POST(req) {
  try {
    const { query, attachment } = await req.json();
    if (!query || typeof query !== "string" || !query.trim()) {
      return Response.json({ error: "Missing query" }, { status: 400 });
    }

    const { userId } = await auth();

    // --- Real quota check, backed by the database, scoped per identity ---
    const identity = userId || (await getOrCreateGuestId());
    const plan = userId ? await getUserPlan(userId) : "free";
    const limit = PLANS[plan]?.searches ?? PLANS.free.searches;

    if (limit !== -1) {
      // Check BEFORE incrementing — a request that's about to be blocked
      // must not consume a quota slot. (An earlier version incremented
      // first and checked after, which let a blocked 9th request still
      // bump the stored count, silently drifting it above the real limit
      // every time someone hit the cap.)
      //
      // Note: check-then-increment isn't atomic, so two simultaneous
      // requests from the same identity at exactly the limit could both
      // slip through. Acceptable at current scale (a user firing two
      // requests in the same millisecond is rare and low-stakes — worst
      // case they get one extra free search). If this becomes a real
      // problem, replace with a single atomic SQL statement using
      // INSERT ... ON CONFLICT with a WHERE clause checking the count.
      const usedSoFar = await getUsageToday(identity);
      if (usedSoFar >= limit) {
        return Response.json({ error: "Daily free limit reached" }, { status: 429 });
      }
      await getAndIncrementUsage(identity);
    }

    // --- Listing match (runs in plain code, never inside the AI call) ---
    const approvedListings = await getApprovedListings();
    // Shopper's country, from Vercel's edge geo headers (no external IP
    // lookup needed, no PII stored — we only read the 2-letter country and
    // use it to filter offers, never persist it). Falls back to null, which
    // disables geo filtering rather than guessing wrong.
    const userCountry =
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("cf-ipcountry") ||
      null;

    const strippedMatch = findMatchingListing(query, approvedListings, userCountry);
    const fullMatch = strippedMatch
      ? approvedListings.find((l) => l.id === strippedMatch.id)
      : null;

    // --- Search-or-skip: only call Brave for genuinely time-sensitive ---
    // --- questions, mirroring the original bosonic layer's behavior.   ---
    let searchContext = "";
    let searchUsed = false;
    if (shouldSearch(query)) {
      const results = await braveSearch(query);
      if (results.length) {
        searchContext = formatSearchContext(results);
        searchUsed = true;
      }
    }

    // --- Build the model request. Only product/brand/price ever go in. ---
    const userContent = `Query: ${query}${
      attachment ? `\nAttachment: "${attachment.name}" (${attachment.type})` : ""
    }${
      strippedMatch
        ? `\n\nA relevant product exists: ${strippedMatch.product} by ${strippedMatch.brand}, ${strippedMatch.price}. Reason about whether this is genuinely a good fit, don't just assume yes.`
        : ""
    }${searchContext}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic API error:", resp.status, errText);
      return Response.json({ error: "Research engine error" }, { status: 502 });
    }

    const data = await resp.json();

    // If the model hit the token ceiling, its JSON is cut off mid-object and
    // will never parse. Say so plainly rather than reporting a vague
    // "unexpected response" — this exact case broke searches when the
    // alternatives field was added without raising max_tokens.
    if (data.stop_reason === "max_tokens") {
      console.error("Model response truncated at max_tokens — raise the cap.");
      return Response.json(
        { error: "Research engine error", detail: "The answer was cut off before it finished. Try a shorter question." },
        { status: 502 }
      );
    }

    let raw = data.content?.map((c) => c.text || "").join("").trim();
    // The model sometimes wraps its JSON in markdown code fences
    // (```json ... ```). Strip them before parsing, otherwise JSON.parse
    // throws on the leading backticks even though the answer is valid.
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse model response as JSON:", raw);
      return Response.json(
        {
          error: "Research engine returned an unexpected response",
          detail: `Could not parse the answer (${raw?.length || 0} chars). Starts: ${String(raw).slice(0, 80)}`,
        },
        { status: 502 }
      );
    }

    // Validate taskType against the fixed taxonomy — microsite linking
    // (matching microsites by shared task type) depends on exact string
    // equality, so a stray capitalization or typo from the model would
    // silently break that feature without this check.
    const VALID_TASK_TYPES = ["research", "creative", "technical", "predictive", "analysis"];
    const taskType = VALID_TASK_TYPES.includes(parsed.taskType) ? parsed.taskType : "research";

    // --- Write the microsite record. Note: queryHash, not the raw query, ---
    // --- is stored, so no individual user's question is ever retained.  ---
    const queryHash = await hashQuery(query);
    await insertMicrosite({
      title: parsed.micrositeTitle,
      summary: parsed.micrositeSummary,
      taskType,
      learnings: parsed.learnings,
      listingId: fullMatch?.id || null,
      queryHash,
    });

    return Response.json({
      headline: parsed.headline,
      reasoning: parsed.reasoning,
      whoItsFor: parsed.whoItsFor,
      whoShouldSkip: parsed.whoShouldSkip,
      confidence: parsed.confidence,
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [],
      taskType,
      matchedListing: buildClientListingPayload(fullMatch),
      plan,
      limit,
      searchUsed,
    });
  } catch (err) {
    console.error("Research route error:", err);
    // Include the real message so the UI can show what actually failed
    // instead of a generic "try rephrasing" that hides the cause.
    return Response.json(
      { error: "Unable to complete research", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

async function hashQuery(text) {
  const enc = new TextEncoder().encode(text.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
