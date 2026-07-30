// lib/search.js
//
// Search provider abstraction. Retrieval is now the fact layer of every
// answer (the model judges, it does not recall), so which index we query
// directly determines answer quality — and Brave's coverage of Indian
// long-tail commerce is its weakest dimension. This lets the provider be
// an env var instead of a code change.
//
//   SEARCH_PROVIDER=brave    (default, proven in production)
//   SEARCH_PROVIDER=serper   (Google's index via serper.dev)
//   SEARCH_PROVIDER=tavily   (LLM-oriented, returns extracted page content)
//   SEARCH_PROVIDER=serplify (live Google SERP scrape; strong Indian price
//                             coverage, but slower and ~$0.005 per call)
//
// HARD-WON RULE #4 APPLIES to the two new adapters: they are written from
// documented request/response shapes but have NOT been verified against a
// live account. Before switching a provider in production, call
//   /api/admin/searchdiag?provider=serper&q=best+tv+under+30000
// which prints the RAW response next to what the adapter parsed out of it.
// If the parse is empty or wrong, fix the adapter against that real
// response rather than trusting this file.
//
// Every adapter returns the same normalized shape: { title, snippet, url }.
// Every adapter returns [] on any failure — a search outage must degrade
// to "answer without live results", never break a search.

const TIME_SENSITIVE_PATTERNS = [
  /\bcurrent(ly)?\b/i,
  /\btoday\b/i,
  /\bright now\b/i,
  /\blatest\b/i,
  /\bnewest\b/i,
  /\bnew(ly)? released\b/i,
  /\bjust (came out|launched|released)\b/i,
  /\bthis (week|month|year)\b/i,
  /\b(20\d{2})\b/,
  /\bin stock\b/i,
  /\bprice (now|today|currently)\b/i,
  /\bon sale\b/i,
  /\bdiscount(ed)?\b/i,
  /\bavailable\b/i,
  /\bcompare\b/i,
  /\bvs\.?\b|\bversus\b/i,
  /\bwhich (one |is )?(is )?better\b/i,
  /\bbetter than\b/i,
  /\breview(s|ed)?\b/i,
  /\bworth (it|buying|the)\b/i,
  /\brecommend(ed|ation)?\b/i,
  /\bquality\b/i,
  /\breliab(le|ility)\b/i,
  /\bdurab(le|ility)\b/i,
  /\bbattery (life|drain|backup)\b/i,
  /\b(problem|problems|issue|issues|complaint|complaints|defect)\b/i,
  /\bgenuine\b|\bfake\b|\bduplicate\b/i,
];

export const THIN_RATING_COUNT = 50;

export function searchProvider() {
  const p = (process.env.SEARCH_PROVIDER || "brave").toLowerCase();
  return ["brave", "serper", "tavily", "serplify"].includes(p) ? p : "brave";
}

// The review lookup uses its OWN provider. Measured 2026-07-30: Brave is
// the only one of the three that returns a `discussions` block — real
// Reddit threads with the question and the top reply — which is far better
// evidence about "is this product actually any good" than a retailer page.
// Serper is faster and cheaper for the main factual query; Brave is better
// for reputation. Using each where it wins costs nothing extra.
export function reviewSearchProvider() {
  const p = (process.env.SEARCH_REVIEW_PROVIDER || "brave").toLowerCase();
  return ["brave", "serper", "tavily", "serplify"].includes(p) ? p : "brave";
}

export function shouldSearch() {
  return process.env.SEARCH_EVERY_QUERY !== "0";
}

export function isFactSensitive(query) {
  return TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(query));
}

export function searchDepth(query) {
  return isFactSensitive(query) ? 6 : 4;
}

export function formatSearchContext(results, label = "Live web results") {
  if (!results.length) return "";
  const lines = results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}`)
    .join("\n");
  return `\n\n${label} (prefer these over your own recollection for prices, availability and product reputation — but still reason independently, don't just repeat them):\n${lines}`;
}

// --- Adapters ----------------------------------------------------------------

// Brave. Proven in production. Country/locale params keep results Indian.
async function braveAdapter(query, count, country) {
  if (!process.env.BRAVE_API_KEY) return { results: [], raw: { skipped: "BRAVE_API_KEY not set" } };
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  if (country) url.searchParams.set("country", country.toLowerCase());

  const resp = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY },
  });
  if (!resp.ok) throw new Error(`Brave ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();

  // Forum threads first when present: for "is this product any good", a
  // Reddit question plus its top reply beats a retailer blurb. The nested
  // `data` object carries the real content — `description` is often just
  // subreddit boilerplate.
  const discussions = (data?.discussions?.results || []).slice(0, 3).map((r) => ({
    title: [r.data?.forum_name, r.data?.title || r.title].filter(Boolean).join(" · "),
    snippet:
      [
        r.data?.question,
        r.data?.top_comment ? `Top reply: ${r.data.top_comment}` : null,
        r.data?.num_answers ? `(${r.data.num_answers} replies)` : null,
      ]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 450) || r.description || "",
    url: r.url || "",
  }));

  const web = (data?.web?.results || []).map((r) => ({
    title: r.title || "",
    snippet: r.description || "",
    url: r.url || "",
  }));

  const results = [...discussions, ...web].slice(0, count + discussions.length);
  return { results, raw: data };
}

// Serper — Google's index. UNVERIFIED: confirm via /api/admin/searchdiag.
// Field names are read defensively so a small shape difference degrades to
// a partial result rather than an exception.
async function serperAdapter(query, count, country) {
  if (!process.env.SERPER_API_KEY) return { results: [], raw: { skipped: "SERPER_API_KEY not set" } };
  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      q: query,
      num: count,
      gl: (country || "IN").toLowerCase(), // geography
      hl: "en",
    }),
  });
  if (!resp.ok) throw new Error(`Serper ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();

  const organic = Array.isArray(data?.organic) ? data.organic : [];
  // Shopping results, when present, are the single most valuable thing an
  // index can give a shopping product: merchant + current price, structured.
  const shopping = Array.isArray(data?.shopping) ? data.shopping : [];

  const results = [
    ...shopping.slice(0, 3).map((s) => ({
      title: [s.title, s.source].filter(Boolean).join(" · "),
      snippet: [s.price ? `Listed at ${s.price}` : null, s.delivery || null]
        .filter(Boolean)
        .join(" — ") || "Shopping result",
      url: s.link || s.url || "",
    })),
    ...organic.slice(0, count).map((r) => ({
      title: r.title || "",
      snippet: r.snippet || r.description || "",
      url: r.link || r.url || "",
    })),
  ];
  return { results, raw: data };
}

// Tavily — returns extracted page content rather than snippets, which suits
// review synthesis. UNVERIFIED: confirm via /api/admin/searchdiag.
async function tavilyAdapter(query, count) {
  if (!process.env.TAVILY_API_KEY) return { results: [], raw: { skipped: "TAVILY_API_KEY not set" } };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: count,
      search_depth: "basic",
    }),
  });
  if (!resp.ok) throw new Error(`Tavily ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const results = (Array.isArray(data?.results) ? data.results : []).slice(0, count).map((r) => ({
    title: r.title || "",
    // Extracted content is long; the model gets a useful slice, not a wall.
    snippet: (r.content || r.snippet || "").slice(0, 400),
    url: r.url || "",
  }));
  return { results, raw: data };
}

// Serplify — a live Google SERP scrape. VERIFIED end to end (2026-07-30)
// against their own cURL and a real playground response: POST to
// https://api.serplify.io/v1/serp/search, Bearer auth, location/language as
// OBJECTS, results under data.items[] with a `type` discriminator. Only
// "organic" items carry title/description/url; the other types
// (people_also_ask, video, related_searches) are structurally different and
// are skipped.
//
// Two properties that shape how it should be used: it returns Indian
// price-aggregator sites (91mobiles, smartprix, mysmartprice) whose snippets
// contain real current prices — excellent for this product — but it is a
// SCRAPE, so it is slower and pricier per call than an index API. Base URL
// is an env var because the playground shows only the path.
async function serplifyAdapter(query, count, country) {
  if (!process.env.SERPLIFY_API_KEY) return { results: [], raw: { skipped: "SERPLIFY_API_KEY not set" } };
  const base = process.env.SERPLIFY_BASE_URL || "https://api.serplify.io";
  const resp = await fetch(`${base}/v1/serp/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SERPLIFY_API_KEY}`,
      "Content-Type": "application/json",
    },
    // Body shape verified against their cURL (2026-07-30): location and
    // language are OBJECTS, not strings — sending strings silently returns
    // the wrong locale or an error depending on their validation.
    body: JSON.stringify({
      keyword: query,
      location: { name: country === "GB" ? "United Kingdom" : country === "US" ? "United States" : "India" },
      language: { code: "en" },
      device: "desktop",
      format: "advanced",
      depth: Math.max(count, 10),
    }),
  });
  if (!resp.ok) throw new Error(`Serplify ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();

  const items = Array.isArray(data?.data?.items) ? data.data.items : [];
  const results = items
    .filter((it) => it?.type === "organic" && (it.title || it.description))
    .slice(0, count)
    .map((it) => ({
      title: it.title || "",
      // Indian price-list snippets are where the current prices live, so
      // they're kept longer than a typical snippet would need.
      snippet: (it.description || "").slice(0, 400),
      url: it.url || "",
    }));
  return { results, raw: data };
}

const ADAPTERS = {
  brave: braveAdapter,
  serper: serperAdapter,
  tavily: tavilyAdapter,
  serplify: serplifyAdapter,
};

// The only function callers need. Never throws.
export async function webSearch(query, count = 4, country = "IN", providerOverride = null) {
  const provider = providerOverride && ADAPTERS[providerOverride] ? providerOverride : searchProvider();
  try {
    const { results } = await ADAPTERS[provider](query, count, country);
    return results;
  } catch (err) {
    console.error(`Search (${provider}) failed:`, err.message);
    return [];
  }
}

// Diagnostic use only: returns the raw provider response alongside the
// parsed results, so an adapter can be verified against reality.
export async function webSearchDiag(query, provider, count = 4, country = "IN") {
  const fn = ADAPTERS[provider] || ADAPTERS[searchProvider()];
  const started = Date.now();
  try {
    const { results, raw } = await fn(query, count, country);
    return {
      ok: true,
      provider,
      // Latency is the decision-critical number: search sits on the critical
      // path of every answer, so a provider that returns better results two
      // seconds slower may still be the wrong choice.
      elapsedMs: Date.now() - started,
      parsed: results,
      raw,
    };
  } catch (err) {
    return { ok: false, provider, elapsedMs: Date.now() - started, error: err.message };
  }
}
