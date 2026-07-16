// lib/braveSearch.js
//
// This mirrors the bosonic layer's "search-or-skip" decision from the
// original SearchLLM.ai architecture: most shopping-research questions
// ("what jacket should I get for hiking") are answerable from the model's
// own knowledge and don't need a live search. Only genuinely time-sensitive
// questions ("what's the current price of X", "newest model released")
// benefit from a Brave Search call — and every search costs latency and
// money, so we only pay that cost when it's likely to matter.
//
// This is a deliberately simple heuristic, not a model call, so it costs
// nothing and adds no latency for the common case where it returns false.

const TIME_SENSITIVE_PATTERNS = [
  /\bcurrent(ly)?\b/i,
  /\btoday\b/i,
  /\bright now\b/i,
  /\blatest\b/i,
  /\bnewest\b/i,
  /\bnew(ly)? released\b/i,
  /\bjust (came out|launched|released)\b/i,
  /\bthis (week|month|year)\b/i,
  /\b(20\d{2})\b/, // a specific year mentioned, e.g. "best laptop 2026"
  /\bin stock\b/i,
  /\bprice (now|today|currently)\b/i,
  /\bon sale\b/i,
  /\bdiscount(ed)?\b/i,
  /\bavailable\b/i,
];

export function shouldSearch(query) {
  return TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(query));
}

// Returns a short array of { title, snippet, url } results, or [] on any
// failure — a Brave outage should degrade to "answer without live search",
// never break the whole research flow.
export async function braveSearch(query, count = 4) {
  if (!process.env.BRAVE_API_KEY) {
    console.warn("BRAVE_API_KEY not set — skipping live search");
    return [];
  }

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": process.env.BRAVE_API_KEY,
      },
    });

    if (!resp.ok) {
      console.error("Brave Search API error:", resp.status, await resp.text());
      return [];
    }

    const data = await resp.json();
    const results = data.web?.results || [];
    return results.slice(0, count).map((r) => ({
      title: r.title,
      snippet: r.description,
      url: r.url,
    }));
  } catch (err) {
    console.error("Brave Search request failed:", err);
    return [];
  }
}

// Formats results into a short block to append to the model prompt.
// Kept deliberately brief — this is grounding context, not a document dump.
export function formatSearchContext(results) {
  if (!results.length) return "";
  const lines = results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}`)
    .join("\n");
  return `\n\nCurrent web results (use these for anything time-sensitive, but still reason independently — don't just repeat them):\n${lines}`;
}
