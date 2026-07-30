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
import { shouldSearch, searchDepth, isFactSensitive, webSearch, reviewSearchProvider, formatSearchContext, THIN_RATING_COUNT } from "@/lib/search";

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
  "learnings": ["short reusable knowledge fragment", "another one", "a third"]
}
Provide 2-3 alternatives that are genuinely relevant to the specific product the person asked about — never generic or unrelated items.

PRICE HONESTY — STRICT. You may put a figure in an alternative's "price" field ONLY if that figure appears in the live web results provided below. If the results do not give you a price for that product, return an empty string. Never price a product from memory: your price knowledge is stale by definition and wrong more often than not for Indian retail, where discounting is heavy and constant. An empty price is a correct and complete answer.
The same rule applies to PACK SIZES and quantities. Do not write "for 1 litre", "for 1-1.5L", "500g" or any other quantity unless that exact packaging appears in the results — Indian detergents, foods and toiletries are sold in pack sizes you will guess wrong (a liquid detergent may be sold by weight, a "1 litre" product may only exist as 3kg). If you know the price but not the pack size, give the price alone. If you know neither, give nothing.
The partner product is the one exception: its real price is supplied to you above and is authoritative — use that, and never contradict it from memory.

WHERE FACTS COME FROM — you are the judgment layer, not the fact layer. Use this hierarchy strictly. (1) The partner product's price, brand, product name, rating and rating count are given to you above from the retailer's own feed: these are authoritative, and you must never contradict or "correct" them from memory. (2) For anything else factual — current prices of other products, what's available now, what reviewers report, which models are current — use the live web results below if they are present, and attribute them naturally ("reviewers consistently mention…", "currently around ₹X"). (3) If a fact you need is in neither place, say you don't know rather than filling the gap from recollection: "I can't verify the current price" is a better answer than a confident wrong number. Your own value is in reasoning about FIT — which trade-offs matter for this particular person's stated need, what to ignore, what would be a mistake for them. Do that freely and with conviction; it's the part no search result can supply.

EVIDENCE WEIGHTING — each offered partner product comes with its retailer rating and the NUMBER of ratings behind it, and the count is what matters: several hundred ratings at 4.2 is real evidence a product works; 4.8 from 27 ratings is nearly no evidence at all and must not be presented as a quality signal. When evidence is thin, say so in plain words ("too few reviews to judge — check current reviews before buying") rather than borrowing confidence from the star number. If live web results are provided below, prefer them over your own recollection for prices, availability and reputation, and say what they tell you.

PRODUCT-CLAIM HONESTY — do not assert specific technical specifications, defect patterns, battery-life figures, or performance numbers for an individual product unless they are widely established. Where you do not know a specific product's real-world track record — which is normal for lesser-known brands — say so plainly instead of implying endorsement, and point the person to current reviews. Category-level reasoning you are confident about is far more useful than confident-sounding specifics you are not.

ADULT-CONTEXT RULE — absolute: when the query contains sexual, suggestive, or adult-leaning language, your ENTIRE answer must never mention children, kids, minors, girls'/boys' clothing or sections, school-age anything, or age groups below adult — not in the headline, body, good-for, skip-if, alternatives, or anywhere else. If any offered product appears to be a children's item on such a query, it is simply irrelevant: do not select it and do not explain or reference it. Write the answer purely for adults, as if children's products do not exist.

RESTRICTED CATEGORIES — this service does not research, recommend, or answer questions about: medicines of ANY kind, over-the-counter or prescription (tell the person plainly that health decisions are for a doctor and a licensed pharmacist, and that we don't deal in medicines; vitamins, supplements and personal care are fine), weapons and ammunition, tobacco and vaping, gambling and betting, alcohol purchase, explicit adult products or services, or dating apps. Sexual-wellness HEALTH products (condoms, lubricants, intimate hygiene) are ordinary purchases and fully supported. If a query seeks a restricted category, say briefly and without judgment that we don't cover it, do not answer the underlying request, and return an empty alternatives array. NEVER return a sponsoredChoiceId for a product in a restricted category, whatever was offered.

Your entire response must be strictly valid JSON. NEVER use the double-quote inch symbol (") inside any string value — write "55-inch", not 55". An unescaped quote breaks the JSON and the person gets an error instead of your answer.

When partner products are offered to you, decide honestly which single one — if any — answers the question, and return its id as sponsoredChoiceId. Two things are never rejection reasons: being cheaper than a stated budget, and not being the absolute best value on the wider market — both belong in your answer text as honest context, alongside the pick.

Worked example of the required calibration: the query is "tv around ₹1 lakh" and the offered list includes a well-rated 55-inch at ₹80,000. That IS a genuine answer — select it, and say in your answer text that stretching toward ₹1.1–1.3 lakh buys OLED-class quality. Returning null there is WRONG: "they could do better at the top of their range" is context for your prose, never a reason to withhold a solid, right-type, in-range product. If you find yourself writing "these are solid products, but…" — select the best of them and put the "but" in your answer.

Null remains correct, and important, when every offered product is the wrong type, priced above what they stated, or too poorly made or rated for a knowledgeable friend to endorse. Never invent an id that was not in the offered list.`;

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

    // Lifecycle matrix (v3): evaluated for EVERY identity, guests included.
    // Free/guest: stage 1 → blocking upgrade interstitial (acknowledgeable),
    // stage 2 → hard Increase Usage gate. Plus: never blocked; alternatives
    // withheld instead (handled after the model call). IP limits backstop
    // identity-hopping for anyone without a payment/purchase history.
    //
    // OPERATION BUDGET (consolidated 2026-07-27): this whole block is now
    // 2 queries for a normal search — one lifecycle statement (which also
    // returns the plan, so no separate plan lookup) and one combined
    // IP record-and-check. Admins skip both entirely.
    const ipHash = hashIp(req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim());
    const admin = isAdminEmail((await currentUser())?.emailAddresses?.[0]?.emailAddress);
    let suppressAlternatives = false;
    let storedPlan = "free";
    let engagementPoints = 0;
    try {
      if (!admin) {
        const lifecycle = await getLifecycleStatus(identity);
        suppressAlternatives = lifecycle.suppressAlternatives;
        storedPlan = lifecycle.plan;
        engagementPoints = lifecycle.engagementPoints;
        if (lifecycle.stage === "upgrade") {
          return Response.json({
            gate: "upgrade",
            searches: lifecycle.searches,
            signedIn: Boolean(userId),
            message: "You're clearly getting value from the research — that's exactly what we built. Honest answers cost real server money, and upgrading is how the platform stays honest instead of ad-driven. Plus unlocks gift-voucher redemption for the points you're already earning.",
          }, { status: 403 });
        }
        if (lifecycle.stage === "recharge") {
          return Response.json({
            gate: "search",
            searches: lifecycle.searches,
            message: `You've made ${lifecycle.searches} picks since your last purchase. Every pick runs paid AI research — to continue, please use Increase Usage. Completing a purchase through any recommendation also resets your free picks.`,
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
    // Registering lifts the daily cap; hitting the 250-point engagement
    // ceiling puts it back. One shared rule, so the header can't promise
    // a different number than the quota check enforces.
    const limit = dailyPickLimit({
      signedIn: Boolean(userId),
      plan,
      engagementPoints,
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

    // Search terms come from the typed query and, when present, from what the
    // image turned out to be. A photo with no typed question still searches.
    const queryTerms = [
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

    // --- Live evidence: two independent reasons to search -----------------
    // 1. The QUERY asks something time-sensitive or evaluative (prices,
    //    comparisons, quality, known problems) — see shouldSearch.
    // 2. The leading partner candidate has THIN rating evidence. A product
    //    with 27 ratings gives the model nothing real to judge from, and
    //    that's exactly when it starts inventing confident specifics. A
    //    targeted review search gives it something true to work with.
    // Both run in parallel and both degrade to silence on any failure —
    // live search improves an answer, it must never be able to break one.
    let searchContext = "";
    let searchUsed = false;
    try {
      const lead = topMatches[0]?.listing;
      const leadIsThin = lead && Number(lead.ratingCount || 0) < THIN_RATING_COUNT;
      const jobs = [];
      // Default path: retrieve for every query, deeper when the question is
      // explicitly about facts. Falls back to keyword-gated searching only
      // if SEARCH_EVERY_QUERY=0 is set.
      const wantSearch = shouldSearch() || isFactSensitive(query);
      if (wantSearch) {
        jobs.push(
          webSearch(query, searchDepth(query), userCountry).then((res) =>
            formatSearchContext(res, "Live web results for this question")
          )
        );
      }
      if (leadIsThin) {
        const name = `${lead.brand || ""} ${lead.product || ""}`.trim().slice(0, 90);
        jobs.push(
          // Reputation lookup deliberately uses the review provider (Brave
          // by default) for its forum-discussion results, while the main
          // factual query above uses the faster, cheaper primary provider.
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

    const userContent = `Query: ${query}${languageContext}${locationContext}${
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
    } catch (firstErr) {
      // Repair the classic shopping-content malformation before failing:
      // an inch mark inside a string ('At ₹1 lakh for a 55"+ TV...') is an
      // unescaped quote to JSON.parse. A digit + quote NOT followed by a
      // JSON structural character (, } ] :) is an inch symbol — rewrite it
      // as "-inch" and retry. Seen in production 2026-07-22.
      try {
        const repaired = raw.replace(/(\d)\s*"(?=\s*[^,}\]:\s]|\s+[a-zA-Z+&(₹])/g, "$1-inch");
        parsed = JSON.parse(repaired);
        console.warn("Model JSON needed inch-mark repair; recovered.");
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
    }

    // Resolve the model's sponsored choice. The id must be one we actually
    // offered — a hallucinated or stale id resolves to nothing, so the model
    // can only ever select from the shortlist, never inject a product. Null
    // or absent means the model judged nothing genuinely relevant, and no
    // card is shown. (Legacy sponsoredRelevant handled during the schema
    // transition: true selects the top candidate, false selects nothing.)
    const offeredIds = new Set(topMatches.map((m) => m.listing.id));
    let chosenId = Number(parsed.sponsoredChoiceId);
    if (!offeredIds.has(chosenId)) chosenId = null;
    if (chosenId === null && parsed.sponsoredRelevant === true && topMatches.length > 0) {
      chosenId = topMatches[0].listing.id;
    }
    const chosenMatch = chosenId ? candidates.find((l) => l.id === chosenId) || null : null;

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
      // Gate input: a page written without live retrieval has no original
      // evidence behind it and cannot earn an indexed URL.
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
      alternatives: suppressAlternatives ? [] : (parsed.alternatives || []),
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
      matchedListing: buildClientListingPayload(chosenMatch),
      alternativesWithheld: suppressAlternatives || undefined,
      // Amazon Associates browse link — ONLY when no partner product
      // matched, so it monetizes otherwise-unmonetized queries without
      // competing with the sponsored card or touching the (provably
      // neutral) alternatives. Direct link, no redirect: Amazon's rules
      // require the destination be apparent; click tracking happens via
      // the client dataLayer event instead. Renders only when the
      // AMAZON_ASSOCIATES_TAG env var is set.
      // Amazon needs a PRODUCT term, not the question. Searching Amazon for
      // "compare borngood detergent with other and suggest the best in
      // quality" returns nothing useful, and showing the question back as a
      // card title looks broken. Prefer the model's shoppingTerm, fall back
      // to the leading alternative's name, and only then the raw query.
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
      // Search points: registered users earn per pick under a daily cap;
      // guests see a day-expiring figure computed from today's picks (never
      // stored — vanishes at midnight unless they sign up and claim). Both
      // are best-effort: a rewards hiccup must never fail a search.
      rewards: await (async () => {
        try {
          if (userId) {
            const sp = await creditSearchPoints(userId);
            return { kind: "user", ...sp };
          }
          const guestToday = picksUsedToday !== null
            ? picksUsedToday * LOYALTY.SEARCH_POINTS.GUEST_PER_PICK
            : await getGuestDayPoints(identity);
          return { kind: "guest", guestToday, perPick: LOYALTY.SEARCH_POINTS.GUEST_PER_PICK };
        } catch (e) {
          console.error("Search points failed:", e.message);
          return null;
        }
      })(),
      // Model-suggested refinements, hard-capped and length-limited — these
      // render as tappable chips that append to the query and re-run.
      refinements: Array.isArray(parsed.refinements)
        ? parsed.refinements.filter((r) => typeof r === "string" && r.trim() && r.length <= 40).slice(0, 3)
        : [],
      // Admins only: what the matcher offered and what the model chose, so
      // "why is there no card" is answerable by looking, not by inference.
      // Never sent to regular users — it names inventory they weren't shown.
      ...(admin
        ? {
            sponsoredDebug: {
              offered: topMatches.map((m) => ({ id: m.listing.id, product: m.listing.product, price: m.listing.price, score: Number(m.score.toFixed(1)) })),
              chosenId: chosenMatch?.id || null,
            },
          }
        : {}),
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
