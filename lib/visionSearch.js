// lib/visionSearch.js
//
// Turns an uploaded product photo into searchable terms.
//
// The Attach button previously sent only a filename, so an uploaded image was
// effectively ignored. This sends the actual image to the model, which
// identifies what the product is, and returns both a human-readable
// description and a set of search terms used to find matching listings.
//
// DESIGN NOTE — why this is not visual similarity search.
// True "find me products that look like this" requires image embeddings for
// every product in the catalogue plus a vector database to compare against.
// With a marketplace feed running to six figures of products, that is a
// project in its own right and an ongoing cost. Vision-to-text captures most
// of the practical value — a shopper photographing a jacket wants "navy
// quilted puffer with a hood", which searches well — at a fraction of the
// complexity. If usage later shows people leaning on photo search heavily,
// embeddings become worth the investment.

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You identify products in photographs so a shopping search can find similar items — and you are also the content gate for uploaded images.

FIRST, before any identification: if the image contains nudity, sexual or explicit content, anything sexualised involving a person who is or appears to be a minor, weapons or ammunition, illegal drugs, medicines or pharmaceutical products, gore, or anything a general-audience shopping service must not process — set "restricted" to the matching category and STOP: set isProduct to false, and leave description, productType, searchTerms and visibleBrand empty/null. Never describe restricted content, not even to explain the refusal.

Categories for "restricted": "adult" (nudity/sexual/explicit), "minors" (ANY sexualised content involving someone who is or appears underage — when in doubt, use this), "weapons", "drugs", "medicines", "other" (gore or otherwise unprocessable). Use null when the image is fine.

Otherwise, look at the image and describe the product a shopper is pointing at. Be concrete and specific about the things that matter when shopping: product type, colour, material, style, notable features, and any visible brand. If the image contains no product, or is too unclear to identify, say so honestly rather than guessing.

Respond ONLY with valid JSON, no markdown fences:
{
  "restricted": null or "adult" or "minors" or "weapons" or "drugs" or "medicines" or "other",
  "isProduct": true or false,
  "description": "one sentence a shopper would recognise, e.g. 'navy quilted puffer jacket with a hood and ribbed cuffs'",
  "productType": "the core noun, e.g. 'puffer jacket'",
  "searchTerms": ["5-8 terms a shopper would type to find this, lowercase"],
  "visibleBrand": "brand name if clearly visible, otherwise null"
}`;

function stripFences(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return t;
}

/**
 * @param {object} image { data: base64 string (no data: prefix), mediaType: 'image/jpeg' }
 * @returns {Promise<null | {isProduct, description, productType, searchTerms, visibleBrand}>}
 */
export async function identifyProductFromImage(image, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!image?.data || !image?.mediaType) return null;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!ALLOWED.includes(image.mediaType)) {
    return { isProduct: false, description: null, productType: null, searchTerms: [], visibleBrand: null };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: "What product is this? Respond with the JSON described." },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Image analysis failed (${resp.status}): ${(await resp.text()).slice(0, 160)}`);
  }

  const data = await resp.json();
  const raw = stripFences(data.content?.map((c) => c.text || "").join(""));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed vision response shouldn't fail the whole search — the user
    // can still get a text-based answer.
    console.error("Could not parse vision response:", raw.slice(0, 160));
    return null;
  }

  const terms = Array.isArray(parsed.searchTerms)
    ? parsed.searchTerms
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim().toLowerCase())
        .slice(0, 8)
    : [];

  const RESTRICTED_VALUES = new Set(["adult", "minors", "weapons", "drugs", "medicines", "other"]);
  const restricted = RESTRICTED_VALUES.has(parsed.restricted) ? parsed.restricted : null;

  return {
    restricted,
    // A restricted image yields nothing downstream, whatever else the model
    // returned — defence in depth against a partially-followed instruction.
    isProduct: restricted ? false : parsed.isProduct !== false,
    description: restricted ? null : parsed.description || null,
    productType: restricted ? null : parsed.productType || null,
    searchTerms: restricted ? [] : terms,
    visibleBrand: restricted ? null : parsed.visibleBrand || null,
  };
}
