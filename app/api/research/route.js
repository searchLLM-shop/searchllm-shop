// app/api/research/route.js
//
// This route replaces the direct browser-to-Anthropic fetch() call from the
// prototype. The API key lives only here, on the server, and is never sent
// to the client. Listing matching also happens here, server-side, against
// the real approved-listings table instead of in-memory React state.

import { auth, currentUser } from "@clerk/nextjs/server";
import { findCandidateListings, insertMicrosite, getAndIncrementUsage, getUsageToday, getUserPlan, reserveSlug } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";
import { checkQuery } from "@/lib/contentFilter";
import { slugify } from "@/lib/slug";
import { languageForModel, resolveLocale } from "@/lib/i18n";
import { recordEvent, recordSearchQuery } from "@/lib/db";
import { identifyProductFromImage } from "@/lib/visionSearch";
import { findMatchingListing, buildClientListingPayload, extractQueryTerms } from "@/lib/listingMatcher";
import { getOrCreateGuestId } from "@/lib/guestId";
import { PLANS } from "@/lib/constants";
import { shouldSearch, braveSearch, formatSearchContext } from "@/lib/braveSearch";

const SYSTEM_PROMPT = `You are SearchLLM, a shopping research assistant whose entire reputation rests on being honest, not on maximizing affiliate revenue.

Price is not quality. A cheap product that does the job well is a legitimate recommendation, not a compromise — say so plainly when it's true, and say when spending more is genuinely wasted. Equally, when a budget option will fail at what the person actually needs, say that too. Judge every product by whether it does the job the person is asking about, never by what it costs. Given a shopping question, produce a single clear recommendation with real reasoning — trade-offs, who it's for, who should skip it. Be specific and a little opinionated, like a knowledgeable friend, not a generic listicle. You may sometimes receive current web search results as additional context — use them for anything time-sensitive (current prices, availability, newest releases), but still reason independently rather than just repeating them. Respond ONLY with valid JSON:
{
  "headline": "one sentence framing of the actual decision the person is making",
  "reasoning": "2-4 sentences of real trade-off reasoning, specific, not generic marketing language",
  "whoItsFor": "one sentence",
  "whoShouldSkip": "one sentence",
  "confidence": "high|medium|low",
  "sponsoredRelevant": true or false — ONLY when a product was offered to you above. Set false if it is not genuinely what the person asked for: wrong category, wrong product type, or outside a budget they stated. Judge it exactly as you would if no money were involved, because your answer decides whether it is shown at all.,
  "alternatives": [{"name": "a real alternative product relevant to THIS query", "note": "one short phrase on the trade-off vs the pick", "price": "approx price or empty string"}],
  "micrositeTitle": "short title for the knowledge microsite",
  "micrositeSummary": "1-2 sentence anonymized summary",
  "publicTopic": "the question rephrased as a generic, searchable shopping topic many different people would type (e.g. 'best whey protein under ₹2000'), in the same language as the rest of your answer. Empty string if the question is too personal, niche, or situation-specific to be useful as a public page",
  "taskType": "research|creative|technical|predictive|analysis",
  "learnings": ["short reusable knowledge fragment", "another one", "a third"]
}
Provide 2-3 alternatives that are genuinely relevant to the specific product the person asked about — never generic or unrelated items.

When a product is offered to you, decide honestly whether it answers the question. If it does not, set sponsoredRelevant to false — it will then not be shown to the person at all, so you do not need to explain why it was irrelevant. Simply answer the question as though it had never been offered.`;

export async function POST(req) {
  try {
    const { query, attachment, geoOverride, locale: requestedLocale } = await req.json();

    // Enforce the acceptable-use rules from the Terms before doing anything
    // else — no model call, no quota consumed, no record written.
    const contentCheck = checkQuery(query);
    if (contentCheck.blocked) {
      return Response.json({ error: contentCheck.reason }, { status: 400 });
    }
    if (!query || typeof query !== "string" || !query.trim()) {
      return Response.json({ error: "Missing query" }, { status: 400 });
    }

    const { userId } = await auth();

    // --- Real quota check, backed by the database, scoped per identity ---
    const identity = userId || (await getOrCreateGuestId());
    const storedPlan = userId ? await getUserPlan(userId) : "free";

    // Admins get unlimited picks. Testing the product shouldn't require
    // burning a paid subscription or waiting for the daily reset.
    const user = userId ? await currentUser() : null;
    const admin = isAdminEmail(user?.emailAddresses?.[0]?.emailAddress);

    const plan = admin ? "plus" : storedPlan;
    const limit = admin ? -1 : (PLANS[plan]?.searches ?? PLANS.free.searches);

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
        // Track how often people run out of picks — the signal that tells us
        // whether the daily limit is doing anything, or just adding friction.
        recordEvent({ eventType: "limit_reached", identity }).catch(() => {});
        return Response.json({ error: "Daily free limit reached" }, { status: 429 });
      }
      await getAndIncrementUsage(identity);
    }

    // --- Listing match (runs in plain code, never inside the AI call) ---
    // Shopper's country, from Vercel's edge geo headers (no external IP
    // lookup needed, no PII stored — we only read the 2-letter country and
    // use it to filter offers, never persist it). Falls back to null, which
    // disables geo filtering rather than guessing wrong.
    const detectedCountry =
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("cf-ipcountry") ||
      null;

    // Admins may simulate another country so they can test offers that are
    // geo-restricted to markets they aren't in (e.g. checking UK Awin
    // merchants from India). Ignored entirely for non-admins, so a normal
    // user can't unlock offers that aren't available where they are.
    const userCountry = admin && geoOverride ? String(geoOverride).toUpperCase() : detectedCountry;

    // Narrow in the database (indexed), then score the small candidate set
    // precisely here. Loading every approved listing per request does not
    // survive a marketplace feed with six figures of products.
    // If an image was attached, identify the product first — its terms feed
    // both the listing search and the recommendation context. Failure here is
    // non-fatal: the user still gets a text-based answer.
    let vision = null;
    if (attachment?.data && attachment?.mediaType?.startsWith("image/")) {
      try {
        vision = await identifyProductFromImage({
          data: attachment.data,
          mediaType: attachment.mediaType,
        });
      } catch (err) {
        console.error("Vision analysis failed:", err.message);
      }
    }

    // Search terms come from the typed query and, when present, from what the
    // image turned out to be. A photo with no typed question still searches.
    const queryTerms = [
      ...extractQueryTerms(query),
      ...(vision?.isProduct ? vision.searchTerms : []),
      ...(vision?.productType ? extractQueryTerms(vision.productType) : []),
    ];
    const candidates = await findCandidateListings(Array.from(new Set(queryTerms)), userCountry);
    const matchText = [query, vision?.description, vision?.productType].filter(Boolean).join(" ");
    const strippedMatch = findMatchingListing(matchText, candidates, userCountry);

    // A search with no relevant partner product is an inventory gap worth
    // measuring — it tells us which categories to go and get merchants for.
    // Recorded as a bare count with no query text attached.
    if (!strippedMatch) {
      recordEvent({ eventType: "no_match", identity, country: userCountry }).catch(() => {});
    }
    // Look the full record up in `candidates` — the DB-side search results.
    // This referenced `approvedListings`, which stopped existing when search
    // moved into Postgres, so any search that DID find a match threw a
    // ReferenceError. It stayed hidden only because matches were rare.
    const fullMatch = strippedMatch
      ? candidates.find((l) => l.id === strippedMatch.id) || null
      : null;

    // Log the query text ANONYMOUSLY — no identity, ever (see search_queries
    // DDL). This runs after the content filter, so prohibited queries are
    // never recorded, and only when something was actually typed — an
    // image-only search has no query text worth aggregating. The unmatched
    // rows are the feed shopping-list for the networks.
    if (query && query.trim()) {
      recordSearchQuery({
        queryText: query,
        matched: !!fullMatch,
        listingId: fullMatch?.id || null,
        network: fullMatch?.network || null,
        country: userCountry,
      }).catch(() => {});
    }

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
    // Tell the model where the shopper is, so it recommends products they can
    // actually buy, priced in their currency. Without this it defaults to US/UK
    // brands and dollar prices — useless advice for a shopper in India.
    const COUNTRY_NAMES = {
      IN: "India", US: "the United States", GB: "the United Kingdom",
      CA: "Canada", AU: "Australia", DE: "Germany", FR: "France",
      SG: "Singapore", AE: "the UAE", NZ: "New Zealand", IE: "Ireland",
    };
    const CURRENCIES = {
      IN: "INR (₹)", US: "USD ($)", GB: "GBP (£)", CA: "CAD ($)",
      AU: "AUD ($)", DE: "EUR (€)", FR: "EUR (€)", SG: "SGD ($)",
      AE: "AED", NZ: "NZD ($)", IE: "EUR (€)",
    };
    // Which language to answer in. Translating afterwards reads badly for
    // anything conversational, so the model writes in the target language
    // from the start — including the alternatives and the microsite copy.
    const locale = resolveLocale({
      stored: requestedLocale,
      country: userCountry,
      acceptLanguage: req.headers.get("accept-language"),
    });
    const language = languageForModel(locale);
    const languageContext =
      language === "English"
        ? ""
        : `\n\nWrite your entire response in ${language}, including the headline, reasoning, who it's for, who should skip it, and the alternatives. Use natural, idiomatic ${language} — this is being read by a native speaker, not translated. Keep the JSON field names in English; only the values are in ${language}.`;

    const locationContext = userCountry
      ? `\n\nThe shopper is in ${COUNTRY_NAMES[userCountry] || userCountry}. Recommend products that are genuinely available to buy there, from brands that sell in that market, and give prices in ${CURRENCIES[userCountry] || "the local currency"}. Do not recommend products the person cannot realistically buy or receive. Apply the same rule to the alternatives.`
      : "";

    const userContent = `Query: ${query}${languageContext}${locationContext}${
      vision?.isProduct && vision.description
        ? `\n\nThe shopper attached a photo of a product. It shows: ${vision.description}${vision.visibleBrand ? ` (visible brand: ${vision.visibleBrand})` : ""}. Treat this as what they are looking for or looking to match, and say what you can see in it so they know you understood the photo.`
        : vision && !vision.isProduct
        ? `\n\nThe shopper attached an image, but no product could be identified in it. Say so plainly and ask what they are looking for.`
        : attachment?.name
        ? `\nAttachment: "${attachment.name}"`
        : ""
    }${
      strippedMatch
        ? `\n\nA relevant product exists: ${strippedMatch.product} by ${strippedMatch.brand}, ${strippedMatch.price}${
            fullMatch?.rating ? `, rated ${fullMatch.rating}/5 by ${fullMatch.ratingCount || "some"} shoppers` : ""
          }. Reason about whether this is genuinely a good fit, don't just assume yes.`
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
        max_tokens: 1800,
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
    // Build a publishable page from the answer — but only when the model was
    // able to reduce the question to a generic shopping topic. A question too
    // personal to generalise gets stored as before and never becomes a page.
    const publicTopic = typeof parsed.publicTopic === "string" ? parsed.publicTopic.trim() : "";
    let slug = null;
    if (publicTopic.length > 8) {
      const base = slugify(publicTopic);
      if (base) {
        try { slug = await reserveSlug(base); } catch { slug = null; }
      }
    }

    await insertMicrosite({
      title: parsed.micrositeTitle,
      summary: parsed.micrositeSummary,
      taskType,
      learnings: parsed.learnings,
      listingId: parsed.sponsoredRelevant === false ? null : (fullMatch?.id || null),
      queryHash,
      slug,
      topic: publicTopic || null,
      headline: parsed.headline,
      body: parsed.reasoning,
      whoFor: parsed.whoItsFor,
      whoSkip: parsed.whoShouldSkip,
      alternatives: parsed.alternatives || [],
      country: userCountry,
    });

    return Response.json({
      headline: parsed.headline,
      reasoning: parsed.reasoning,
      whoItsFor: parsed.whoItsFor,
      whoShouldSkip: parsed.whoShouldSkip,
      confidence: parsed.confidence,
      imageUnderstanding: vision?.isProduct ? vision.description : null,
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [],
      taskType,
      // The model's judgment now decides whether a paid placement appears.
      // Previously the card rendered whenever the keyword matcher found
      // something, even when the model had just told the reader the product
      // was irrelevant — showing a buy button under an explanation of why not
      // to buy it. A sponsored slot we can't defend is worth less than an
      // empty one.
      matchedListing: parsed.sponsoredRelevant === false ? null : buildClientListingPayload(fullMatch),
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
