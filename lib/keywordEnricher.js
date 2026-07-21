// lib/keywordEnricher.js
//
// Generates useful search keywords for listings using the model.
//
// Why this exists: deriveKeywords() just splits the product title into words,
// which works acceptably for product feeds ("Pink Floral Ruche Side Midi
// Skirt" -> pink, floral, midi, skirt) but fails badly for affiliate campaign
// titles. A vCommission offer called "Trunativ.co Ecommerce CPS - India"
// yields "trunativ, ecommerce, india" — none of which a shopper would ever
// type. So the listing can never match "best whey protein", even though that
// is exactly what the merchant sells.
//
// This asks the model what a shopper would actually search for, given the
// brand, title, category and description. Keywords are matched against the
// query in lib/listingMatcher.js, so better keywords mean better (and more
// honest) sponsored matches — and fewer irrelevant ones.

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 20;

// Keywords must be in the language the shopper will actually type. A German
// product given English keywords can never match a German query, and vice
// versa — the geo filter already keeps the markets apart, so each product's
// keywords should follow its own market.
function systemPromptFor(language) {
  const langRule =
    language === "German"
      ? `Write the keywords in GERMAN, as a German shopper would type them.

German compounds matter: for "Regenjacke", also include the parts a shopper might search on their own ("jacke", "regenbekleidung"). Someone typing "jacke" should still find a "Regenjacke".

Keep brand and model names in their original form — nobody translates "Bosch" or "iPhone". Include an English term only when Germans genuinely use it (e.g. "laptop", "smartphone").`
      : `Write the keywords in ENGLISH, as a shopper would type them.`;

  return `You generate search keywords for shopping listings.

For each listing you are given, return the words and short phrases a real shopper would type when looking for what this merchant actually sells. Base it on the brand, title, category and description.

${langRule}

Rules:
- 5-10 keywords per listing, lowercase
- Use the PRODUCT TYPE the merchant sells, not marketing or affiliate jargon
- NEVER include affiliate/campaign terms: cps, cpi, cpa, ecommerce, campaign, offer, affiliate
- Include the brand name only if shoppers would search it by name
- Prefer common shopper language over technical terms
- If the description is vague, infer sensibly from the brand name and category; if you truly cannot tell, return an empty array for that listing

Respond ONLY with valid JSON, no markdown fences:
{"results": [{"id": <listing id>, "keywords": ["...", "..."]}]}`;
}

function stripFences(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return t;
}

async function enrichBatch(batch, apiKey, language = "English") {
  const payload = batch.map((l) => ({
    id: l.id,
    brand: l.brand,
    title: l.product,
    category: l.category,
    // Keep descriptions short — they're only context, and long ones burn
    // tokens fast across a batch.
    description: (l.pitch || "").slice(0, 200),
  }));

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPromptFor(language),
      messages: [{ role: "user", content: JSON.stringify({ listings: payload }) }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }

  const data = await resp.json();
  if (data.stop_reason === "max_tokens") {
    throw new Error("Keyword response truncated — reduce batch size.");
  }

  const raw = stripFences(data.content?.map((c) => c.text || "").join(""));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse keyword response: ${raw.slice(0, 120)}`);
  }

  const out = new Map();
  for (const r of parsed.results || []) {
    if (!r || r.id == null || !Array.isArray(r.keywords)) continue;
    const clean = r.keywords
      .filter((k) => typeof k === "string" && k.trim())
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 2 && k.length < 40)
      .slice(0, 10);
    if (clean.length) out.set(String(r.id), Array.from(new Set(clean)));
  }
  return out;
}

// Generates keywords for the given listings. Returns a Map of
// listingId(string) -> string[]. Processes in batches so one oversized
// request can't blow the token limit, and so a single bad batch doesn't
// lose the whole run.
// Runs batches with limited concurrency. Sequential calls made a 300-listing
// run take several minutes — long enough that the browser abandoned the
// request ("Failed to fetch") even though the work was still going. Three at
// a time is roughly 3x faster while staying well inside Anthropic's rate
// limits, and a failed batch never discards the ones that succeeded.
const CONCURRENCY = 3;


// Which language a listing's keywords should be in, taken from the markets it
// serves. Regions are set at sync time from the feed's own metadata.
const GERMAN_REGIONS = new Set(["DE", "AT", "CH", "LI"]);

export function languageForListing(listing) {
  const regions = Array.isArray(listing?.regions) ? listing.regions : [];
  if (regions.length && regions.every((r) => GERMAN_REGIONS.has(String(r).toUpperCase()))) {
    return "German";
  }
  return "English";
}

export async function generateKeywords(listings, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Split by language first, so each request carries one clear instruction
  // rather than asking the model to switch language per row.
  const byLanguage = new Map();
  for (const l of listings) {
    const lang = languageForListing(l);
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(l);
  }

  const batches = [];
  for (const [language, group] of byLanguage) {
    for (let i = 0; i < group.length; i += BATCH_SIZE) {
      batches.push({ language, listings: group.slice(i, i + BATCH_SIZE) });
    }
  }

  const results = new Map();
  const errors = [];

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      group.map((b) => enrichBatch(b.listings, apiKey, b.language))
    );
    settled.forEach((outcome, j) => {
      if (outcome.status === "fulfilled") {
        for (const [id, kws] of outcome.value) results.set(id, kws);
      } else {
        console.error(`Keyword batch ${i + j + 1} (${group[j].language}) failed:`, outcome.reason?.message);
        errors.push(String(outcome.reason?.message || outcome.reason));
      }
    });
  }

  return { results, errors };
}
