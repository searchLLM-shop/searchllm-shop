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
import { findTopMatchingListings, buildClientListingPayload, extractQueryTerms } from "@/lib/listingMatcher";
import { creditSearchPoints, getGuestDayPoints, getLifecycleStatus, hashIp, recordAndCheckIp, checkAndConsumeQuota } from "@/lib/db";
import { getOrCreateGuestId } from "@/lib/guestId";
import { PLANS, LOYALTY, dailyPickLimit } from "@/lib/constants";
import { shouldSearch, searchDepth, isFactSensitive, webSearch, contextSearchProvider, priceSearchProvider, reviewSearchProvider, formatSearchContext, THIN_RATING_COUNT } from "@/lib/search";
import { extractIntent, formatIntentContext } from "@/lib/queryIntent";

const SYSTEM_PROMPT = `You are SearchLLM, a shopping research assistant whose entire reputation rests on being honest, not on maximizing affiliate revenue.

Price is not quality. A cheap product that does the job well is a legitimate recommendation, not a compromise — say so plainly when it's true, and say when spending more is genuinely wasted. Equally, when a budget option will fail at what the person actually needs, say that too. Judge every product by whether it does the job the person is asking about, never by what it costs. Given a shopping question, produce a single clear recommendation with real reasoning — trade-offs, who it's for, who should skip it. Be specific and a little opinionated, like a knowledgeable friend, not a generic listicle. You may sometimes receive current web search results as additional context — use them for anything time-sensitive (current prices, availability, newest releases), but still reason independently rather than just repeating them. Respond ONLY with valid JSON:
{
  "headline": "one sentence framing of the actual decision the person is making",
  "reasoning": "2-4 sentences of real trade-off reasoning, specific, not generic marketing language",
  "whoItsFor": "one sentence",
  "whoShouldSkip": "one sentence",
  "confidence": "high|medium|low",
  "sponsoredChoiceId": the numeric id of the ONE offered partner product that genuinely answers the question, or null — ONLY when products were offered to you above. Null if none truly fits: wrong category, wrong product type, priced above what the person stated, or a product too poor for any reasonable shopper with this query to be satisfied buying. The bar is "would a knowledgeable friend be comfortable saying: this one is a solid buy for what you asked" — NOT "is this the single best product on the market at this price". Comparing the offered products to better market alternatives belongs in your answer text, where you should do it freely and honestly; it is not a reason to suppress a genuinely good offered product. Likewise a budget phrased as a maximum is a ceiling, not a target: priced-under still qualifies. Judge exactly as you would if no money were involved.,
  "shoppingTerm": "The specific PRODUCT NAME to shop for — brand plus model or variant, as printed on the pack: 'Born Good Plant-Based Liquid Detergent', 'Logitech MK270 Wireless Keyboard Mouse Combo'. NOT a category ('plant based detergent') and never the question restated. If the honest answer is a category rather than one product, name the single best product in it.",
  "alternatives": [{"name": "a real alternative product relevant to THIS query", "note": "one short phrase on the trade-off vs the pick", "price": "see the price rule below — empty string is the correct answer whenever you are not confident"}],
  "micrositeTitle": "short title for the knowledge microsite",
  "micrositeSummary": "1-2 sentence anonymized summary",
  "publicTopic": "the question rephrased as a generic, searchable shopping topic many different people would type (e.g. 'best whey protein under ₹2000'), in the same language as the rest of your answer. Empty string if the question is too personal, niche, or situation-specific to be useful as a public page",
  "refinements": ["up to 3 SHORT phrases (each under 6 words) the person could APPEND to their query to get a sharper, more personal answer — e.g. a budget ('under ₹500'), a use case ('for oily skin'), a form/spec ('resin form'). Each must read naturally when appended to their exact query text. Empty array when the query is already specific enough that refining would not change the answer"],
  "taskType": "research|creative|technical|predictive|analysis",
  "learnings": ["short reusable knowledge fragment", "another one", "a third"],
  "candidateFitment": [{"id": the numeric id of an offered partner product, "fits": true or false, "reason": "one short phrase — why it does or doesn't fit what you know about the person's need and purpose, from the section below", "valueStatement": "what buying this says about or does for the shopper — ONLY when fits is true, empty string otherwise"}],
  "popularityLevel": "high|medium|low|niche — your own calibrated judgment of how commonly shoppers search for and buy this product or category, not a fact you need evidence for"
}
Provide 2-3 alternatives that are genuinely relevant to the specific product the person asked about — never generic or unrelated items. Where you have a genuine choice, prefer alternatives that appear in the live web results below — those are the ones you can quote a real price for, and an alternative with a price is more useful to the reader than one without. NEVER list the product you selected as sponsoredChoiceId among the alternatives: it is already shown to the reader as the pick, and repeating it there makes the comparison look padded.

TWO JUDGMENTS, BOTH REQUIRED, AND THEY OFTEN DISAGREE.

First judgment — what is actually good right now. Decide this from the evidence in front of you: the live prices, what reviewers and owners report, rating counts, what the market currently offers at this tier. Not from what was true a year ago, and not from brand reputation alone. This is the question "what would a knowledgeable person call a good product today".

Second judgment — what is right for THIS person. Their occasion, their stated requirements, their constraints, what they said matters. A product can be excellent and still be wrong for them; a product can be unremarkable and be exactly right.

Hold both, and when they diverge, say so plainly rather than collapsing them. "The best plant-based detergent is Born Good; the best cleaner overall is Ariel Matic; you asked for plant-based, so Born Good is your answer" is a better paragraph than either judgment alone. The Good for / Skip if lines exist to carry this divergence — use them for it.

Where the person's framing rests on an assumption the evidence contradicts, correct it kindly and briefly, then answer the question they meant. Do not simply agree, and do not lecture.

WHAT THE PERSON IS ACTUALLY OPTIMISING FOR — work this out before you judge anything, because getting it wrong makes an otherwise correct answer useless.

Attributes named in the question are REQUIREMENTS, not preferences, in EVERY category without exception. Fashion: colour, fabric, fit, occasion, size ("maroon", "cotton", "plus size", "for a wedding"). Beauty and personal care: skin type, formulation, exclusions ("for oily skin", "fragrance-free", "sulphate-free", "ubtan"). Home and appliances: capacity, energy rating, noise, dimensions, mounting ("1.5 ton", "5 star", "silent", "wall-mount", "fits a small kitchen"). Electronics: screen size, storage, connectivity, platform, ports ("75 inch", "512GB", "Google TV", "USB-C", "for gaming"). Food and grocery: dietary and sourcing ("organic", "sugar-free", "gluten-free", "cold-pressed"). Baby and health: age band and safety ("newborn", "BPA-free", "for sensitive skin"). Sustainability anywhere: "eco-friendly", "plant-based", "biodegradable", "recycled".
A product that misses a stated attribute is not a cheaper alternative — it is the wrong product, and you must not offer it as one however good its price or rating. Someone asking for a maroon dress does not want a navy one at a discount; someone asking for a silent air purifier does not want a louder cheaper one; someone asking for organic honey does not want conventional honey that costs less.

Price is a constraint ONLY when the person raises it — "under ₹X", "around ₹X", "cheap", "budget", "value for money". When they have not raised it: do not make price the deciding factor, do not present a more expensive product apologetically, and do not treat the cheapest option as the default winner. A person who asks for an environmentally friendly detergent is telling you what matters to them; answering with the cheapest conventional one ignores the question they asked.

CHOOSE THE BALANCED OPTION. With no stated budget, pick what a knowledgeable friend would call the sensible middle: it meets every stated attribute, it has credible evidence behind it, and its price is reasonable for what it is. Not the cheapest, not the most aspirational.

THEN GIVE RANGE. Use the alternatives to let the reader move up or down from your pick — ideally one simpler or more affordable option and one better or more premium one, each with the trade-off named in its note ("cheaper, but conventional chemistry", "better build, roughly twice the price"). Every alternative must still satisfy the stated attributes; range means range of price and capability, never range of relevance.

PRICE HONESTY — STRICT, and note that one whole arm of retrieval exists to make this possible. The results labelled "Current prices found for this product in India" were fetched specifically so you can price the alternatives you name. Mine them: price-listing pages routinely carry figures for several competing products in one snippet, and a figure for a product you are about to name as an alternative is exactly what you should be extracting. Prefer naming alternatives you can actually price.
You may put a figure in an alternative's "price" field ONLY if that figure appears in the live web results provided below. If the results do not give you a price for that product, return an empty string. Never price a product from memory: your price knowledge is stale by definition and wrong more often than not for Indian retail, where discounting is heavy and constant. An empty price is a correct and complete answer.
The same rule applies to PACK SIZES and quantities. Do not write "for 1 litre", "for 1-1.5L", "500g" or any other quantity unless that exact packaging appears in the results — Indian detergents, foods and toiletries are sold in pack sizes you will guess wrong (a liquid detergent may be sold by weight, a "1 litre" product may only exist as 3kg). If you know the price but not the pack size, give the price alone. If you know neither, give nothing.
The partner product is the one exception: its real price is supplied to you above and is authoritative — use that, and never contradict it from memory.

WHERE FACTS COME FROM — you are the judgment layer, not the fact layer. Use this hierarchy strictly. (1) The partner product's price, brand, product name, rating and rating count are given to you above from the retailer's own feed: these are authoritative, and you must never contradict or "correct" them from memory. (2) For anything else factual — current prices of other products, what's available now, what reviewers report, which models are current — use the live web results below if they are present, and attribute them naturally ("reviewers consistently mention…", "currently around ₹X"). (3) If a fact you need is in neither place, say you don't know rather than filling the gap from recollection: "I can't verify the current price" is a better answer than a confident wrong number. Your own value is in reasoning about FIT — which trade-offs matter for this particular person's stated need, what to ignore, what would be a mistake for them. Do that freely and with conviction; it's the part no search result can supply.

EVIDENCE WEIGHTING — each offered partner product comes with its retailer rating and the NUMBER of ratings behind it, and the count is what matters: several hundred ratings at 4.2 is real evidence a product works; 4.8 from 27 ratings is nearly no evidence at all and must not be presented as a quality signal. When evidence is thin, say so in plain words ("too few reviews to judge — check current reviews before buying") rather than borrowing confidence from the star number. If live web results are provided below, prefer them over your own recollection for prices, availability and reputation, and say what they tell you.

PRODUCT-CLAIM HONESTY — do not assert specific technical specifications, defect patterns, battery-life figures, or performance numbers for an individual product unless they are widely established. Where you do not know a specific product's real-world track record — which is normal for lesser-known brands — say so plainly instead of implying endorsement, and point the person to current reviews. Category-level reasoning you are confident about is far more useful than confident-sounding specifics you are not.

ADULT-CONTEXT RULE — absolute: when the query contains sexual, suggestive, or adult-leaning language, your ENTIRE answer must never mention children, kids, minors, girls'/boys' clothing or sections, school-age anything, or age groups below adult — not in the headline, body, good-for, skip-if, alternatives, or anywhere else. If any offered product appears to be a children's item on such a query, it is simply irrelevant: do not select it and do not explain or reference it. Write the answer purely for adults, as if children's products do not exist.

RESTRICTED CATEGORIES — this service does not research, recommend, or answer questions about: medicines of ANY kind, over-the-counter or prescription (tell the person plainly that health decisions are for a doctor and a licensed pharmacist, and that we don't deal in medicines; vitamins, supplements and personal care are fine), weapons and ammunition, tobacco and vaping, gambling and betting, alcohol purchase, explicit adult products or services, or dating apps. Sexual-wellness HEALTH products (condoms, lubricants, intimate hygiene) are ordinary purchases and fully supported. If a query seeks a restricted category, say briefly and without judgment that we don't cover it, do not answer the underlying request, and return an empty alternatives array. NEVER return a sponsoredChoiceId for a product in a restricted category, whatever was offered.

Your entire response must be strictly valid JSON. NEVER use the double-quote inch symbol (") inside any string value — write "55-inch", not 55". An unescaped quote breaks the JSON and the person gets an error instead of your answer.

When partner products are offered to you, decide honestly which single one — if any — answers the question, and return its id as sponsoredChoiceId. Two things are never rejection reasons: being cheaper than a stated budget, and not being the absolute best value on the wider market — both belong in your answer text as honest context, alongside the pick.

CANDIDATE FITMENT — fill in candidateFitment for EVERY offered partner product, not just the one you pick. This is the explicit record of why each one was or wasn't a fit, judged against everything you know from the "What the person is asking for" section below — including why they want it and what they expect out of it, when given, not just the bare spec. A product can match every stated attribute and still not fit the underlying purpose; say so in reason when that's what's happening. fits should agree with sponsoredChoiceId: the product you selected must have fits:true, and any product you declined must have fits:false with a real, specific reason — never a placeholder like "not the best option". This is read by the team, not shown to the shopper, so be direct.

POPULARITY — popularityLevel is your own estimate of how commonly shoppers in general search for and buy this product or category, independent of whether any offered product fits. "high" for everyday, broadly-searched categories (phone chargers, running shoes, rice cookers); "niche" for something only a narrow slice of shoppers would ever look for (a specific specialist tool, a very unusual combination of requirements). This is a judgment call, not a fact — unlike prices and specs, you are not required to have evidence for it, just a calibrated sense of demand.

Worked example of the required calibration: the query is "tv around ₹1 lakh" and the offered list includes a well-rated 55-inch at ₹80,000. That IS a genuine answer — select it, and say in your answer text that stretching toward ₹1.1–1.3 lakh buys OLED-class quality. Returning null there is WRONG: "they could do better at the top of their range" is context for your prose, never a reason to withhold a solid, right-type, in-range product. If you find yourself writing "these are solid products, but…" — select the best of them and put the "but" in your answer.

Null remains correct, and important, when every offered product is the wrong type, priced above what they stated, or too poorly made or rated for a knowledgeable friend to endorse. Never invent an id that was not in the offered list.`;

export async function POST(req) {
  try {
    const { query, attachment, geoOverride, locale: requestedLocale, clarifications } = await req.json();

    // Enforce the acceptable-use rules from the Terms before doing anything
    // else — no model call, no quota consumed, no record written.
    const contentCheck = checkQuery(query);
    if (contentCheck.blocked) {
      return Response.json({ error: contentCheck.reason }, { status: 400 });
    }
    if (!query || typeof query !== "string" || !query.trim()) {
      return Response.json({ error: "Missing query" }, { status: 400 });
    }

    // Answers to the pre-research clarifying question(s) from app/api/clarify
    // — optional, and the search must work identically to today when this is
    // absent (the shopper skipped, or the clarify step had nothing to ask).
    // Re-validated here rather than trusted from the client: only strings,
    // capped in count and length, exactly like every other free-text input
    // that reaches the model prompt below.
    const safeClarifications = Array.isArray(clarifications)
      ? clarifications
          .filter((c) => c && typeof c.answer === "string" && c.answer.trim())
          .slice(0, 3)
          .map((c) => ({
            question: typeof c.question === "string" ? c.question.trim().slice(0, 120) : "",
            answer: c.answer.trim().slice(0, 200),
          }))
      : [];

    const { userId } = await auth();

    // --- Real quota check, backed by the database, scoped per identity ---
    const identity = userId || (await getOrCreateGuestId());

    // Lifecycle gate (redesigned 2026-08-25): free users and guests are
    // NEVER blocked here any more — the old query/click checkpoint ladder
    // is gone. The only remaining gate is Plus-only: LOYALTY.PLUS_QUERY_CYCLE_LIMIT
    // queries with zero purchases since the last reset → hard Increase
    // Usage gate. IP limits still backstop identity-hopping for anyone
    // without a payment/purchase history, for everyone.
    //
    // OPERATION BUDGET (consolidated 2026-07-27): this whole block is now
    // 2 queries for a normal search — one lifecycle statement (which also
    // returns the plan, so no separate plan lookup) and one combined
    // IP record-and-check. Admins skip both entirely.
    const ipHash = hashIp(req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim());
    const admin = isAdminEmail((await currentUser())?.emailAddresses?.[0]?.emailAddress);
    let storedPlan = "free";
    try {
      if (!admin) {
        const lifecycle = await getLifecycleStatus(identity);
        storedPlan = lifecycle.plan;
        if (lifecycle.stage === "recharge") {
          return Response.json({
            gate: "search",
            searches: lifecycle.searches,
            message: `You've made ${lifecycle.searches} picks since your last purchase or Increase Usage payment. Every pick runs paid AI research — to continue, please use Increase Usage (₹${LOYALTY.RECHARGE_PRICE_INR}). Completing a purchase through any recommendation also resets the cycle for free.`,
          }, { status: 403 });
        }
        // Records this hit and returns the rolling window in one statement.
        // Users with a purchase/payment history are exempt from IP limits
        // (shared carrier IPs must never punish paying customers), but we
        // still record so the counters stay complete.
        const ipState = await recordAndCheckIp(ipHash, "search");
        if (!lifecycle.hasCredit && ipState.searchGated) {
          return Response.json({ gate: "search", searches: LOYALTY.IP_GATE.searches, message: "This network has reached its free research limit. To continue, sign in and use Increase Usage — or complete a purchase through any recommendation." }, { status: 403 });
        }
      }
    } catch (err) {
      console.error("Lifecycle check failed:", err.message);
    }

    // Admins get unlimited picks. Testing the product shouldn't require
    // burning a paid subscription or waiting for the daily reset.
    const plan = admin ? "plus" : storedPlan;
    const limit = dailyPickLimit({
      signedIn: Boolean(userId),
      plan,
      isAdmin: admin,
    });

    // Today's pick count, returned by the quota statement — guests' day
    // points are derived from it instead of costing another query.
    let picksUsedToday = null;
    if (limit !== -1) {
      // ONE atomic statement (2026-07-27): the insert only increments while
      // under the limit, so a blocked request consumes nothing and two
      // simultaneous requests at the boundary can't both slip through —
      // the race the previous read-then-increment version documented.
      const quota = await checkAndConsumeQuota(identity, limit);
      picksUsedToday = quota.used;
      if (!quota.allowed) {
        // Track how often people run out of picks — the signal that tells us
        // whether the daily limit is doing anything, or just adding friction.
        recordEvent({ eventType: "limit_reached", identity }).catch(() => {});
        return Response.json({ error: "Daily free limit reached" }, { status: 429 });
      }
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
    // Server-side upload cap. The client resizes to 1024px JPEG (~200KB),
    // but a scripted client bypasses the browser entirely — without this
    // check, oversized base64 payloads flow straight into vision-call cost
    // and function memory. 3MB base64 ≈ 2.2MB image: far above anything the
    // legitimate client produces, low enough to bound abuse.
    if (attachment?.data && attachment.data.length > 3_000_000) {
      return Response.json({ error: "Image too large — please attach a photo under 2MB." }, { status: 413 });
    }

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

      // The vision call doubles as the image content gate. A restricted
      // image stops the request HERE: no candidate search, no main model
      // call, no microsite, no query log — the same posture as blocked text
      // queries. The image itself was never stored (it travels in the
      // request body only) and is discarded with the request.
      if (vision?.restricted) {
        const IMAGE_BLOCK_MESSAGES = {
          adult: "We can't process this image. Please attach a photo of a product you'd like researched.",
          minors: "We can't process this image.",
          weapons: "We don't cover weapons or ammunition — including in photos. Try a different shopping question.",
          drugs: "We can't process this image. Try a different shopping question.",
          medicines:
            "We don't research or recommend medicines of any kind — including from photos. Health decisions belong with a doctor or a licensed pharmacist.",
          other: "We can't process this image. Please attach a clear photo of a product.",
        };
        return Response.json(
          { error: IMAGE_BLOCK_MESSAGES[vision.restricted] || IMAGE_BLOCK_MESSAGES.other },
          { status: 400 }
        );
      }

      // Backstop: whatever the image turned out to be, its derived text
      // must pass the same query filter as typed text — a photo of a
      // product is a query in picture form.
      const derived = `${vision?.productType || ""} ${vision?.description || ""}`.trim();
      if (derived) {
        const imageCheck = checkQuery(derived);
        if (imageCheck.blocked) {
          return Response.json({ error: imageCheck.reason }, { status: 400 });
        }
      }
    }

    // Understand the query BEFORE retrieving. The intent pass turns
    // "women maroon dress for wedding" into a product type, hard
    // requirements, an occasion and an expected price band — so the matcher
    // searches on the right words and the answering model learns that the
    // occasion implies a product tier, not merely another keyword.
    const intentSource = [
      query,
      vision?.productType,
      vision?.description,
      // Clarifying-question answers feed intent extraction the same way the
      // typed query does, so retrievalTerms/contextQuery/priceQuery (and
      // therefore both the listing match and the live-search arms below)
      // reflect what the shopper actually said, not just the original query.
      ...safeClarifications.map((c) => c.answer),
    ].filter(Boolean).join(" ");
    const intent = await extractIntent(intentSource);

    // --- Retrieval arms 1+2 START HERE, concurrently with the candidate DB
    // lookup below (2026-08-19 speed pass) — they only need `intent`/`query`,
    // never the candidate shortlist, so there was no reason they were
    // waiting on that DB round trip to even begin. webSearch() is an async
    // function, so a promise it returns can only ever REJECT, never throw
    // synchronously here — any failure is caught where these are awaited,
    // in the try/catch further down. Arm 3 (thin-rating review) still has
    // to wait for topMatches and is added to this same array once known.
    const wantSearch = shouldSearch() || isFactSensitive(query);
    const earlySearchJobs = wantSearch
      ? [
          webSearch(intent?.contextQuery || query, searchDepth(query), userCountry, contextSearchProvider())
            .then((res) => formatSearchContext(res, "What the web says about this need (perspective, comparisons, owner reports)")),
          webSearch(intent?.priceQuery || query, 4, userCountry, priceSearchProvider())
            .then((res) => formatSearchContext(res, "Current prices found for this product in India (use these figures, not your recollection)")),
        ]
      : [];

    // Search terms come from the typed query and, when present, from what the
    // image turned out to be. A photo with no typed question still searches.
    // Intent terms ADD precision on top — they never replace the mechanical
    // extraction, so a failed intent call costs nothing.
    const queryTerms = [
      ...(intent?.retrievalTerms || []).flatMap((t) => t.split(/\s+/)),
      ...extractQueryTerms(query),
      ...(vision?.isProduct ? vision.searchTerms : []),
      ...(vision?.productType ? extractQueryTerms(vision.productType) : []),
    ];
    const candidates = await findCandidateListings(Array.from(new Set(queryTerms)), userCountry);
    const matchText = [query, vision?.description, vision?.productType].filter(Boolean).join(" ");
    // Top few plausible candidates — the MODEL chooses which one (if any)
    // genuinely answers the question. Mechanical scoring is the recall gate;
    // the model is the precision gate. See findTopMatchingListings.
    // 8, not 4: the model is a far better judge than the mechanical score
    // is a ranker, so give it a wider shortlist to choose from. At ~30
    // tokens per candidate line this costs almost nothing, and it makes
    // "the real product was #5 in mechanical order" a non-event.
    const topMatches = findTopMatchingListings(matchText, candidates, userCountry, 8);

    // A search with no relevant partner product is an inventory gap worth
    // measuring — it tells us which categories to go and get merchants for.
    // Recorded as a bare count with no query text attached.
    if (topMatches.length === 0) {
      recordEvent({ eventType: "no_match", identity, country: userCountry }).catch(() => {});
    }
    // Log the query text ANONYMOUSLY — no identity, ever (see search_queries
    // DDL). This runs after the content filter, so prohibited queries are
    // never recorded, and only when something was actually typed — an
    // image-only search has no query text worth aggregating. Matched here
    // means "inventory had a plausible candidate" (retrieval level), which
    // is the inventory-gap signal the log exists for.
    const topCandidate = topMatches.length
      ? candidates.find((l) => l.id === topMatches[0].listing.id) || null
      : null;
    if (query && query.trim()) {
      recordSearchQuery({
        queryText: query,
        matched: topMatches.length > 0,
        listingId: topCandidate?.id || null,
        network: topCandidate?.network || null,
        country: userCountry,
      }).catch(() => {});
    }

    // --- Retrieval: two arms already firing above, joined by a third here --
    //
    // One search engine cannot serve both of arms 1+2's jobs. Perspective
    // ("is this any good, what goes wrong with it, what do owners say") and
    // price tail ("what does it cost right now in India") reward completely
    // different queries and different indexes — measured 2026-07-30: Brave
    // alone returns forum discussions, Serper alone reliably surfaces Indian
    // price-aggregator pages with live rupee figures. Running both, on two
    // queries written by the intent layer for their separate purposes,
    // gives the synthesis layer two genuinely different views instead of
    // one view twice.
    //
    // A third, conditional arm: when the leading partner candidate has thin
    // rating evidence, a targeted review lookup on that exact product — this
    // one DOES need topMatches, so it's only ever addable here, not above.
    //
    // All arms run concurrently and every one degrades to silence — live
    // retrieval improves an answer, it must never be able to prevent one.
    let searchContext = "";
    let searchUsed = false;
    try {
      const lead = topMatches[0]?.listing;
      const leadIsThin = lead && Number(lead.ratingCount || 0) < THIN_RATING_COUNT;
      const jobs = [...earlySearchJobs];

      if (leadIsThin) {
        const name = `${lead.brand || ""} ${lead.product || ""}`.trim().slice(0, 90);
        jobs.push(
          webSearch(`${name} review`, 3, userCountry, reviewSearchProvider()).then((res) =>
            formatSearchContext(res, `What reviewers say about ${name} (this product has only ${lead.ratingCount || 0} ratings on the retailer, so treat it as thin evidence)`)
          )
        );
      }

      if (jobs.length) {
        const parts = (await Promise.all(jobs)).filter(Boolean);
        searchContext = parts.join("");
        searchUsed = parts.length > 0;
      }
    } catch (err) {
      console.error("Live search failed, answering without it:", err.message);
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

    // What the shopper told us via the pre-research clarifying question(s)
    // (app/api/clarify) — this is what makes those answers actually reach
    // synthesis, not just retrieval. Treated as authoritative context, same
    // weight as the original query.
    const clarificationContext = safeClarifications.length
      ? `\n\nThe shopper answered a quick question before we researched:\n${safeClarifications
          .map((c) => `- ${c.question ? `${c.question} ` : ""}${c.answer}`)
          .join("\n")}`
      : "";

    const userContent = `Query: ${query}${languageContext}${locationContext}${clarificationContext}${
      vision?.isProduct && vision.description
        ? `\n\nThe shopper attached a photo of a product. It shows: ${vision.description}${vision.visibleBrand ? ` (visible brand: ${vision.visibleBrand})` : ""}. Treat this as what they are looking for or looking to match, and say what you can see in it so they know you understood the photo.`
        : vision && !vision.isProduct
        ? `\n\nThe shopper attached an image, but no product could be identified in it. Say so plainly and ask what they are looking for.`
        : attachment?.name
        ? `\nAttachment: "${attachment.name}"`
        : ""
    }${
      topMatches.length
        ? `\n\nThe following partner products exist in our inventory and MIGHT be relevant:\n${topMatches
            .map(
              (m, i) =>
                `${i + 1}. [id ${m.listing.id}] ${m.listing.product} by ${m.listing.brand}, ${m.listing.price}${
                  m.listing.rating ? `, rated ${m.listing.rating}/5 by ${m.listing.ratingCount || "some"} shoppers` : ""
                }`
            )
            .join("\n")}\nJudge each exactly as you would if no money were involved. Choose the ONE that genuinely answers the question, or none.`
        : ""
    }${formatIntentContext(intent)}${searchContext}`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // Raised from 1800 (2026-08-19): candidateFitment adds up to ~8
        // more small objects to the response. See the max_tokens comment
        // below this call — the same truncation failure that broke
        // searches when alternatives was added is exactly what under-
        // provisioning headroom on a schema change causes again.
        max_tokens: 2400,
        // Low temperature deliberately (2026-07-30). The default of 1.0 made
        // identical questions produce materially different verdicts run to
        // run — one call selected a product, the next declined entirely.
        // A shopper who re-asks must not get a contradictory answer, and we
        // can't calibrate a prompt against a moving target. Not zero: a
        // little variation keeps the prose from reading mechanically.
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        // Streamed (2026-08-19): this call is comfortably the longest single
        // leg of the whole pipeline — a large structured JSON response from
        // Sonnet, made larger still by candidateFitment. Streaming lets the
        // shopper watch the pick appear as it's written instead of staring
        // at a spinner for the entire generation. Nothing downstream
        // (parsing, validation, gating, the DB write, rewards) changes — it
        // still only runs once the full response has accumulated; only the
        // wire format to OUR client changes, from one JSON body to a
        // sequence of NDJSON lines ending in one "final" line carrying
        // exactly the same payload shape this route has always returned.
        stream: true,
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("Anthropic API error:", anthropicResp.status, errText);
      return Response.json({ error: "Research engine error" }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const outStream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        // --- Relay Anthropic's SSE stream, accumulating the full text as
        // it arrives and forwarding each text delta to our own client
        // immediately. Anthropic's stream is a sequence of `data: {...}`
        // lines (blank-line separated); we only care about
        // content_block_delta (the actual text) and message_delta's
        // stop_reason (the max_tokens truncation check below).
        let raw = "";
        let stopReason = null;
        let pickSent = false;
        const offeredIdsEarly = new Set(topMatches.map((m) => m.listing.id));
        try {
          const reader = anthropicResp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop(); // last (possibly partial) line stays buffered
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (!payload || payload === "[DONE]") continue;
              let evt;
              try { evt = JSON.parse(payload); } catch { continue; }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                raw += evt.delta.text;
                send({ type: "delta", text: evt.delta.text });

                // Early pick: the moment "alternatives" (schema field 8)
                // has actually closed, sponsoredChoiceId (field 6, earlier
                // in the same object) is guaranteed complete too — send the
                // pick card now rather than making the shopper wait through
                // candidateFitment and the rest of the bookkeeping fields
                // that follow it in the same JSON object.
                if (!pickSent) {
                  const altsRaw = extractBalancedValue(raw, "alternatives");
                  if (altsRaw !== null) {
                    try {
                      const altsParsed = JSON.parse(altsRaw);
                      const idRaw = extractBareValue(raw, "sponsoredChoiceId");
                      let pickChosenId = idRaw && idRaw !== "null" ? Number(idRaw) : null;
                      if (pickChosenId !== null && !offeredIdsEarly.has(pickChosenId)) pickChosenId = null;
                      const pickChosenMatch = pickChosenId ? candidates.find((l) => l.id === pickChosenId) || null : null;

                      // Amazon Associates fallback (2026-08-22): the ONLY
                      // actionable product card when nothing was offered or
                      // nothing offered fit — this was a "final"-only field
                      // before, so on a no-match answer the shopper saw the
                      // verdict text and refinement chips early but no
                      // product card at all until candidateFitment and the
                      // rest finished streaming, several seconds later. Same
                      // logic as the final event's amazonBrowse, computed
                      // here instead so it arrives at the same moment as
                      // everything else.
                      const earlyAlternatives = Array.isArray(altsParsed) ? altsParsed.slice(0, 3) : [];
                      const amazonBrowseEarly = (() => {
                        if (pickChosenMatch || !process.env.AMAZON_ASSOCIATES_TAG) return undefined;
                        const term = [
                          extractStringField(raw, "shoppingTerm") || "",
                          earlyAlternatives[0]?.name || "",
                          typeof query === "string" ? query.trim() : "",
                        ].find((t) => t && t.length > 2);
                        if (!term) return undefined;
                        return {
                          term: term.slice(0, 80),
                          url: `https://www.amazon.in/s?k=${encodeURIComponent(term.slice(0, 120))}&tag=${process.env.AMAZON_ASSOCIATES_TAG}`,
                        };
                      })();

                      pickSent = true;
                      send({
                        type: "pick",
                        matchedListing: buildClientListingPayload(pickChosenMatch),
                        alternatives: earlyAlternatives,
                        amazonBrowse: amazonBrowseEarly,
                      });
                    } catch {
                      // Not actually valid JSON yet despite balanced
                      // brackets (mid-escape edge case) — the "final" event
                      // will carry this correctly once the stream completes.
                    }
                  }
                }
              } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
                stopReason = evt.delta.stop_reason;
              }
            }
          }
        } catch (err) {
          console.error("Anthropic stream read failed:", err.message);
          send({ type: "error", error: "Research engine error", detail: String(err?.message || err) });
          controller.close();
          return;
        }

        // If the model hit the token ceiling, its JSON is cut off mid-object
        // and will never parse. Say so plainly rather than reporting a vague
        // "unexpected response" — this exact case broke searches when the
        // alternatives field was added without raising max_tokens.
        if (stopReason === "max_tokens") {
          console.error("Model response truncated at max_tokens — raise the cap.");
          send({ type: "error", error: "Research engine error", detail: "The answer was cut off before it finished. Try a shorter question." });
          controller.close();
          return;
        }

        // --- Everything below is the same parsing/validation/write logic
        // this route has always run, now inside the stream so a failure
        // here becomes a clean {type:"error"} line instead of either an
        // unhandled rejection or a client left waiting forever.
        try {
          raw = raw.trim();
          // The model sometimes wraps its JSON in markdown code fences
          // (```json ... ```). Strip them before parsing, otherwise
          // JSON.parse throws on the leading backticks even though the
          // answer is valid.
          if (raw.startsWith("```")) {
            raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          }
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (firstErr) {
            // Repair the classic shopping-content malformation before
            // failing: an inch mark inside a string ('At ₹1 lakh for a
            // 55"+ TV...') is an unescaped quote to JSON.parse. A digit +
            // quote NOT followed by a JSON structural character (, } ] :)
            // is an inch symbol — rewrite it as "-inch" and retry. Seen in
            // production 2026-07-22.
            try {
              const repaired = raw.replace(/(\d)\s*"(?=\s*[^,}\]:\s]|\s+[a-zA-Z+&(₹])/g, "$1-inch");
              parsed = JSON.parse(repaired);
              console.warn("Model JSON needed inch-mark repair; recovered.");
            } catch (e) {
              console.error("Failed to parse model response as JSON:", raw);
              send({
                type: "error",
                error: "Research engine returned an unexpected response",
                detail: `Could not parse the answer (${raw?.length || 0} chars). Starts: ${String(raw).slice(0, 80)}`,
              });
              controller.close();
              return;
            }
          }

          // Resolve the model's sponsored choice. The id must be one we
          // actually offered — a hallucinated or stale id resolves to
          // nothing, so the model can only ever select from the shortlist,
          // never inject a product. Null or absent means the model judged
          // nothing genuinely relevant, and no card is shown. (Legacy
          // sponsoredRelevant handled during the schema transition: true
          // selects the top candidate, false selects nothing.)
          const offeredIds = new Set(topMatches.map((m) => m.listing.id));
          let chosenId = Number(parsed.sponsoredChoiceId);
          if (!offeredIds.has(chosenId)) chosenId = null;
          if (chosenId === null && parsed.sponsoredRelevant === true && topMatches.length > 0) {
            chosenId = topMatches[0].listing.id;
          }
          const chosenMatch = chosenId ? candidates.find((l) => l.id === chosenId) || null : null;

          // Validate taskType against the fixed taxonomy — microsite linking
          // (matching microsites by shared task type) depends on exact
          // string equality, so a stray capitalization or typo from the
          // model would silently break that feature without this check.
          const VALID_TASK_TYPES = ["research", "creative", "technical", "predictive", "analysis"];
          const taskType = VALID_TASK_TYPES.includes(parsed.taskType) ? parsed.taskType : "research";

          // Fermionic/anyonic fitment — validate ids belong to what was
          // actually offered, same guard as sponsoredChoiceId above: a
          // hallucinated id is dropped rather than trusted. Admin-only (see
          // sponsoredDebug below), this is the explicit "why we said no"
          // record for every candidate, not just the one that was picked.
          const candidateFitment = Array.isArray(parsed.candidateFitment)
            ? parsed.candidateFitment
                .filter((c) => c && offeredIds.has(Number(c.id)))
                .map((c) => ({
                  id: Number(c.id),
                  fits: c.fits === true,
                  reason: typeof c.reason === "string" ? c.reason.slice(0, 200) : "",
                  valueStatement: c.fits === true && typeof c.valueStatement === "string" ? c.valueStatement.slice(0, 200) : "",
                }))
            : [];

          // Cosmic popularity signal — the model's own judgment, validated
          // against the fixed taxonomy lib/publicationGate.js understands.
          // Never blocks: an invalid/missing value is stored as null, which
          // the gate treats as "unknown, don't block" rather than a failure.
          const VALID_POPULARITY = ["high", "medium", "low", "niche"];
          const popularityLevel = VALID_POPULARITY.includes(parsed.popularityLevel) ? parsed.popularityLevel : null;

          // --- Write the microsite record. Note: queryHash, not the raw ---
          // --- query, is stored, so no user's question is ever retained. ---
          const queryHash = await hashQuery(query);
          // Build a publishable page from the answer — but only when the
          // model was able to reduce the question to a generic shopping
          // topic. A question too personal to generalise gets stored as
          // before and never becomes a page.
          const publicTopic = typeof parsed.publicTopic === "string" ? parsed.publicTopic.trim() : "";
          let slug = null;
          if (publicTopic.length > 8) {
            const base = slugify(publicTopic);
            if (base) {
              try { slug = await reserveSlug(base); } catch { slug = null; }
            }
          }

          // Fire-and-forget (2026-08-19 speed pass): nothing in the
          // response below reads from this call's result, so awaiting it
          // before responding was pure added latency — one DB round trip
          // the shopper waited through for no reason. Same pattern already
          // used for recordEvent/recordSearchQuery above. Bonus: a write
          // hiccup here (sitemap/analytics bookkeeping) can no longer fail
          // the whole request.
          insertMicrosite({
            title: parsed.micrositeTitle,
            summary: parsed.micrositeSummary,
            taskType,
            // Gate input: a page written without live retrieval has no
            // original evidence behind it and cannot earn an indexed URL.
            searchPerformed: searchUsed,
            learnings: parsed.learnings,
            listingId: chosenMatch?.id || null,
            queryHash,
            slug,
            topic: publicTopic || null,
            headline: parsed.headline,
            body: parsed.reasoning,
            whoFor: parsed.whoItsFor,
            whoSkip: parsed.whoShouldSkip,
            // Safety net for the prompt rule above: drop any alternative
            // that names the product we already showed as the sponsored pick.
            alternatives: (parsed.alternatives || []).filter((a) => {
              if (!chosenMatch || !a?.name) return true;
              const alt = String(a.name).toLowerCase().replace(/[^a-z0-9 ]/g, " ");
              const picked = `${chosenMatch.brand || ""} ${chosenMatch.product || ""}`
                .toLowerCase()
                .replace(/[^a-z0-9 ]/g, " ");
              const altWords = new Set(alt.split(/\s+/).filter((w) => w.length > 3));
              const pickWords = new Set(picked.split(/\s+/).filter((w) => w.length > 3));
              if (!altWords.size) return true;
              let shared = 0;
              for (const w of altWords) if (pickWords.has(w)) shared++;
              return shared / altWords.size < 0.6; // mostly the same product
            }),
            country: userCountry,
            // What lib/clarify.js asked and what the shopper answered, if
            // anything — recorded alongside the answer it shaped, same idea
            // as gate_result, so the questions that actually moved a pick
            // can be reviewed later rather than trusted blind.
            clarifications: safeClarifications,
            // Cosmic gate input — see lib/publicationGate.js's popularity
            // check. Recorded even when null (model didn't return a valid
            // value): a missing signal is "unknown, don't block", never a
            // silent failure.
            popularityLevel,
          }).catch((err) => console.error("insertMicrosite failed:", err.message));

          send({
            type: "final",
            headline: parsed.headline,
            reasoning: parsed.reasoning,
            whoItsFor: parsed.whoItsFor,
            whoShouldSkip: parsed.whoShouldSkip,
            confidence: parsed.confidence,
            imageUnderstanding: vision?.isProduct ? vision.description : null,
            alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [],
            taskType,
            // The model's judgment now decides whether a paid placement
            // appears. Previously the card rendered whenever the keyword
            // matcher found something, even when the model had just told
            // the reader the product was irrelevant — showing a buy button
            // under an explanation of why not to buy it. A sponsored slot
            // we can't defend is worth less than an empty one.
            matchedListing: buildClientListingPayload(chosenMatch),
            // Amazon Associates browse link — ONLY when no partner product
            // matched, so it monetizes otherwise-unmonetized queries
            // without competing with the sponsored card or touching the
            // (provably neutral) alternatives. Direct link, no redirect:
            // Amazon's rules require the destination be apparent; click
            // tracking happens via the client dataLayer event instead.
            // Renders only when the AMAZON_ASSOCIATES_TAG env var is set.
            // Amazon needs a PRODUCT term, not the question. Prefer the
            // model's shoppingTerm, fall back to the leading alternative's
            // name, and only then the raw query.
            amazonBrowse: (() => {
              if (chosenMatch || !process.env.AMAZON_ASSOCIATES_TAG) return undefined;
              const term = [
                typeof parsed.shoppingTerm === "string" ? parsed.shoppingTerm.trim() : "",
                parsed.alternatives?.[0]?.name || "",
                typeof query === "string" ? query.trim() : "",
              ].find((t) => t && t.length > 2);
              if (!term) return undefined;
              return {
                term: term.slice(0, 80),
                url: `https://www.amazon.in/s?k=${encodeURIComponent(term.slice(0, 120))}&tag=${process.env.AMAZON_ASSOCIATES_TAG}`,
              };
            })(),
            // Search points: registered users earn per pick under a daily
            // cap; guests see a day-expiring figure computed from today's
            // picks (never stored — vanishes at midnight unless they sign
            // up and claim). Both are best-effort: a rewards hiccup must
            // never fail a search.
            rewards: await (async () => {
              try {
                if (userId) {
                  const sp = await creditSearchPoints(userId);
                  return { kind: "user", ...sp };
                }
                const guestToday = picksUsedToday !== null
                  ? picksUsedToday * LOYALTY.POINTS.GUEST_PER_PICK
                  : await getGuestDayPoints(identity);
                return { kind: "guest", guestToday, perPick: LOYALTY.POINTS.GUEST_PER_PICK };
              } catch (e) {
                console.error("Search points failed:", e.message);
                return null;
              }
            })(),
            // Model-suggested refinements, hard-capped and length-limited —
            // these render as tappable chips that append to the query and
            // re-run.
            refinements: Array.isArray(parsed.refinements)
              ? parsed.refinements.filter((r) => typeof r === "string" && r.trim() && r.length <= 40).slice(0, 3)
              : [],
            // Admins only: what the matcher offered and what the model
            // chose, so "why is there no card" is answerable by looking, not
            // by inference. Never sent to regular users — it names
            // inventory they weren't shown.
            ...(admin
              ? {
                  sponsoredDebug: {
                    offered: topMatches.map((m) => ({ id: m.listing.id, product: m.listing.product, price: m.listing.price, score: Number(m.score.toFixed(1)) })),
                    chosenId: chosenMatch?.id || null,
                    // Fermionic/anyonic — why every offered candidate was or
                    // wasn't a fit, not just the one that was picked.
                    candidateFitment,
                    popularityLevel,
                  },
                }
              : {}),
            plan,
            limit,
            searchUsed,
          });
        } catch (err) {
          console.error("Research route post-processing error:", err);
          send({ type: "error", error: "Unable to complete research", detail: String(err?.message || err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(outStream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
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

// --- Mid-stream partial extraction (2026-08-19 speed pass) ---------------
//
// The product pick + alternatives (fields 6-8 of SYSTEM_PROMPT's schema)
// are what a shopper is actually waiting to see, but candidateFitment and
// the other backend-only bookkeeping fields that follow them in the same
// JSON object can add real generation time on top — time the shopper has
// no reason to wait through before seeing their pick. These two helpers let
// the SSE relay loop below detect the moment "alternatives" has actually
// closed and send matchedListing/alternatives immediately, well before the
// full response (and its "final" event) is done.
//
// String-aware balanced-bracket extraction: returns the raw JSON substring
// for `"key": [...]` or `"key": {...}` once its closing bracket has
// actually streamed in (brackets inside quoted strings don't count), or
// null if the key isn't found yet or its value isn't closed yet.
function extractBalancedValue(text, key) {
  const keyIdx = text.indexOf(`"${key}"`);
  if (keyIdx === -1) return null;
  const colonIdx = text.indexOf(":", keyIdx + key.length + 2);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  const openChar = text[i];
  if (openChar !== "[" && openChar !== "{") return null;
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  return null; // not closed yet
}

// A bare (unquoted) value — number or null — followed by a real delimiter,
// so a still-typing "4" isn't mistaken for a complete "4" when it's about
// to become "42".
function extractBareValue(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+|null)\\s*[,}]`));
  return m ? m[1] : null;
}

// A closed string value — real closing quote required, so a still-typing
// value isn't returned half-written. Used at "pick" time for shoppingTerm,
// which by then (field 7 of the schema, one before alternatives) is
// guaranteed to have already closed.
function extractStringField(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function hashQuery(text) {
  const enc = new TextEncoder().encode(text.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
