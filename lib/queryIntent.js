// lib/queryIntent.js
//
// Understand the query BEFORE retrieving anything.
//
// The problem this solves: extractQueryTerms() sees tokens, not meaning. For
// "women maroon dress for wedding" it produces {women, maroon, dress,
// wedding} and weights them equally — so the matcher happily shortlists
// ₹359 fast-fashion maxi dresses, and the model is then stuck choosing
// between wrong-tier products while writing that better ones exist. The
// word "wedding" isn't a keyword, it's an occasion that implies formality,
// fabric, silhouette and a spend band. Nothing in the pipeline knew that.
//
// So: a fast, cheap Haiku pass turns the query into structured intent, and
// that intent drives three things instead of one — which terms to retrieve
// on, what to search the web for, and what the answering model is told
// about what the person actually wants.
//
// Design constraints:
//   - Haiku, not Sonnet: this is extraction, not judgment. ~400ms, cheap.
//   - Never blocks: any failure returns null and the caller falls back to
//     the existing mechanical extraction. A degraded answer beats none.
//   - No opinions: it must not decide what to recommend, only what was
//     asked. Judgment stays with the answering model, which sees evidence.

const INTENT_PROMPT = `You extract structured intent from a shopping query. You do not recommend anything.

Respond with ONLY valid JSON, no markdown fences:
{
  "productType": "the core thing being shopped for, singular and plain: 'liquid detergent', 'maxi dress', 'smart tv'",
  "attributes": ["hard requirements stated or clearly implied by the words used — colour, material, size, capacity, formulation, dietary, compatibility"],
  "occasion": "the situation the product is for, if any: 'wedding', 'office', 'gym', 'gift', 'daily use' — else null",
  "audience": "who it's for if stated: 'women', 'men', 'kids', 'newborn' — else null",
  "priority": "the ONE thing that matters most, in the person's own framing: 'eco-credentials' | 'quality' | 'price' | 'occasion-appropriateness' | 'performance' | 'convenience' | 'unstated'",
  "budgetStated": true or false,
  "expectedPriceBand": "what a well-chosen product for this need typically costs in India, as a range like '900-4000', reasoning from the occasion and category — NOT from any budget the person gave. null if you genuinely cannot say.",
  "retrievalTerms": ["3-8 terms to search a product catalogue with, most discriminating first — include the product type, colour/material, and size/capacity; EXCLUDE occasion and filler words"],
  "contextQuery": "one search-engine query that would surface PERSPECTIVE on this need — comparisons, what owners report, what to look for, common problems. Phrase it the way someone researching would, not the way someone buying would.",
  "priceQuery": "one search-engine query that would surface CURRENT PRICES for this product in India — product type plus the words a price-listing page would carry. Short and commercial.",
  "purpose": "why they actually want it / what job it does for them, in a few words — e.g. 'daily commute comfort', 'gift for a colleague', 'replacing a broken one', 'marathon training'. Distinct from productType and occasion: this is the underlying reason, inferred from the query and any clarifying answers folded into it. null if genuinely not inferable.",
  "expectedValue": "the outcome or benefit they're implicitly expecting from this purchase, in a few words — e.g. 'long-term durability over upfront cost', 'impress guests', 'save time weekly', 'peace of mind on safety'. null if genuinely not inferable — do not invent one just to fill the field."
}

Rules that matter:
- occasion changes what is suitable. A wedding dress needs occasion-appropriate silhouette and fabric; a gym shoe needs cushioning. Reflect that in expectedPriceBand, which is your estimate of what the RIGHT product costs — a wedding outfit is not a ₹300 purchase even when ₹300 dresses exist.
- attributes are requirements, not wishes. If they said maroon, maroon is an attribute.
- budgetStated is true ONLY if they named an amount or said cheap/budget/affordable/premium. "for a wedding" is not a budget.
- retrievalTerms feed a keyword matcher: give it product words, not sentiment. For "women maroon dress for wedding" → ["maroon dress", "gown", "anarkali", "women", "maxi"].
- Never invent attributes the person didn't ask for.
- contextQuery and priceQuery are deliberately different. For "women maroon dress for wedding": contextQuery might be "what to wear to an indian wedding guest maroon gown advice", priceQuery might be "maroon anarkali gown price india". One is asking what's good, the other is asking what things cost.
- purpose and expectedValue are about the PERSON, not the product spec — they're what makes two shoppers asking the identical productType+attributes still deserve different picks. Only fill them from what's actually stated or clearly implied (including any clarifying answers folded into the query text you're given); null is the correct answer far more often than a guess.`;

export async function extractIntent(query) {
  if (!query || typeof query !== "string" || query.trim().length < 3) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

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
        max_tokens: 500,
        temperature: 0,          // extraction must be reproducible
        system: INTENT_PROMPT,
        messages: [{ role: "user", content: query.slice(0, 400) }],
      }),
    });
    if (!resp.ok) throw new Error(`intent ${resp.status}`);
    const data = await resp.json();
    let raw = (data.content?.[0]?.text || "").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(raw);

    return {
      productType: typeof parsed.productType === "string" ? parsed.productType : null,
      attributes: Array.isArray(parsed.attributes) ? parsed.attributes.slice(0, 8).map(String) : [],
      occasion: parsed.occasion || null,
      audience: parsed.audience || null,
      priority: parsed.priority || "unstated",
      budgetStated: parsed.budgetStated === true,
      expectedPriceBand: parsed.expectedPriceBand || null,
      retrievalTerms: Array.isArray(parsed.retrievalTerms)
        ? parsed.retrievalTerms.slice(0, 8).map((t) => String(t).toLowerCase().trim()).filter(Boolean)
        : [],
      contextQuery: typeof parsed.contextQuery === "string" && parsed.contextQuery.trim() ? parsed.contextQuery.trim() : null,
      priceQuery: typeof parsed.priceQuery === "string" && parsed.priceQuery.trim() ? parsed.priceQuery.trim() : null,
      purpose: typeof parsed.purpose === "string" && parsed.purpose.trim() ? parsed.purpose.trim().slice(0, 120) : null,
      expectedValue: typeof parsed.expectedValue === "string" && parsed.expectedValue.trim() ? parsed.expectedValue.trim().slice(0, 120) : null,
    };
  } catch (err) {
    // Extraction is an improvement, never a dependency.
    console.error("Query intent extraction failed, using mechanical terms:", err.message);
    return null;
  }
}

// Rendered into the answering model's context so it reasons about the need
// rather than re-deriving it from the raw sentence.
export function formatIntentContext(intent) {
  if (!intent) return "";
  const lines = [];
  if (intent.productType) lines.push(`Product sought: ${intent.productType}`);
  if (intent.attributes?.length) lines.push(`Hard requirements: ${intent.attributes.join(", ")}`);
  if (intent.occasion) lines.push(`Occasion: ${intent.occasion}`);
  if (intent.audience) lines.push(`For: ${intent.audience}`);
  // Why they want it and what they expect out of it, not just what it is —
  // this is what lets two people asking for the same spec get different
  // picks when their underlying need differs. Feed the fitment judgment
  // below, not just the retrieval terms above.
  if (intent.purpose) lines.push(`Why they want it: ${intent.purpose}`);
  if (intent.expectedValue) lines.push(`What they expect to get out of it: ${intent.expectedValue}`);
  lines.push(`What matters most: ${intent.priority}`);
  lines.push(
    intent.budgetStated
      ? "The person stated a budget — treat it as a ceiling."
      : "The person stated NO budget — do not make price the deciding factor, and do not default to the cheapest option."
  );
  if (intent.expectedPriceBand) {
    lines.push(
      `A well-chosen product for this need typically costs around ₹${intent.expectedPriceBand} in India. If every offered partner product sits far below that band, say plainly that the offered options are a tier below what this need calls for — and choose none rather than pretending otherwise.`
    );
  }
  return `\n\nWhat the person is asking for (extracted before retrieval):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
