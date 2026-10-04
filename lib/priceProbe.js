// lib/priceProbe.js
//
// Live price checks by reading the merchant's own product page, because the
// affiliate feeds are not a reliable price source: the vCommission feed is
// imported once and never refreshed, and the hourly sync only adds NEW
// products. (Found live: a Myntra listing showed ₹1,299 while the page said
// ₹1,119.)
//
// What this does and deliberately does not do:
//   * It reads the merchant URL that is INSIDE the affiliate link (the
//     `url=` parameter) — it never requests the affiliate tracking URL
//     itself, which would register a fake click with the network.
//   * Only hosts we have confirmed return a price in the server-rendered
//     HTML are fetched (ALLOWED_HOSTS). That list is also the SSRF guard:
//     nothing outside it is ever requested, including via redirects.
//   * It reads standard structured data (schema.org JSON-LD, then Open Graph
//     / product meta tags) — the same data the merchant publishes for search
//     engines. Script-rendered storefronts that put no price in the HTML
//     (Shopsy/Flipkart) report "unsupported" rather than guessing.
//   * One request per listing per check, with a hard timeout; callers are
//     expected to throttle (see lib/livePrice.js).

// Hosts verified to carry the price in the initial HTML. Add a host only
// after checking a real product page from production.
const ALLOWED_HOSTS = ["myntra.com"];

const PRICE_PARAMS = ["url", "ued", "u", "dest", "destination"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2_500_000;

// OFF by default (2026-10-04). Myntra serves a "Site Maintenance" page with no
// product data to requests from Vercel's server addresses (the same page loads
// in full from a normal connection), so every check came back "no_price".
// Until there is a legitimate source — an official price feed/API from
// vCommission or Myntra — nothing is fetched at all. Set LIVE_PRICE_CHECK=on
// in the environment to re-enable; no code change needed.
const LIVE_PRICE_ENABLED = process.env.LIVE_PRICE_CHECK === "on";

function hostAllowed(hostname) {
  if (!LIVE_PRICE_ENABLED) return false;
  const h = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

// The merchant product URL embedded in an affiliate tracking link, or null.
export function merchantUrlFromNetworkLink(networkLink) {
  let link;
  try { link = new URL(networkLink); } catch { return null; }
  for (const p of PRICE_PARAMS) {
    const v = link.searchParams.get(p);
    if (!v) continue;
    try {
      const dest = new URL(v);
      if (dest.protocol === "http:" || dest.protocol === "https:") return dest;
    } catch { /* try next param */ }
  }
  // The link may itself already be the merchant URL.
  if (hostAllowed(link.hostname)) return link;
  return null;
}

export function isProbeSupported(networkLink) {
  const u = merchantUrlFromNetworkLink(networkLink);
  return Boolean(u && hostAllowed(u.hostname));
}

// --- Parsing ---------------------------------------------------------------

function toNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function offersOf(node) {
  if (!node || typeof node !== "object") return [];
  const o = node.offers;
  if (!o) return [];
  return Array.isArray(o) ? o : [o];
}

function walkJsonLd(value, out) {
  if (Array.isArray(value)) { value.forEach((v) => walkJsonLd(v, out)); return; }
  if (!value || typeof value !== "object") return;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Product") || types.includes("ProductGroup")) out.push(value);
  if (value["@graph"]) walkJsonLd(value["@graph"], out);
}

function availabilityOf(offer) {
  const a = String(offer?.availability || "").toLowerCase();
  if (!a) return null;
  if (a.includes("instock") || a.includes("limitedavailability") || a.includes("preorder")) return true;
  if (a.includes("outofstock") || a.includes("soldout") || a.includes("discontinued")) return false;
  return null;
}

// Pulls { price, currency, inStock } from product-page HTML, or null.
export function extractPriceFromHtml(html) {
  if (!html) return null;

  // 1) schema.org JSON-LD
  const products = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walkJsonLd(JSON.parse(m[1].trim()), products); } catch { /* malformed block — skip */ }
  }
  for (const p of products) {
    for (const offer of offersOf(p)) {
      const price =
        toNumber(offer.price) ??
        toNumber(offer.lowPrice) ??
        toNumber(offer.priceSpecification?.price);
      if (price) {
        return {
          price,
          currency: offer.priceCurrency || offer.priceSpecification?.priceCurrency || null,
          inStock: availabilityOf(offer),
          source: "jsonld",
        };
      }
    }
  }

  // 2) Open Graph / product meta tags
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, "i");
    return (html.match(re) || html.match(re2) || [])[1] || null;
  };
  const metaPrice = toNumber(meta("product:price:amount") || meta("og:price:amount") || meta("price"));
  if (metaPrice) {
    return {
      price: metaPrice,
      currency: meta("product:price:currency") || meta("og:price:currency") || meta("priceCurrency"),
      inStock: null,
      source: "meta",
    };
  }
  return null;
}

// --- Fetching --------------------------------------------------------------

async function fetchHtml(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!hostAllowed(url.hostname)) throw new Error(`host not allowed: ${url.hostname}`);
    const resp = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-IN,en;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get("location");
      if (!loc) throw new Error("redirect without location");
      url = new URL(loc, url);
      continue;
    }
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    const text = await resp.text();
    return text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text;
  }
  throw new Error("too many redirects");
}

// Live price for one listing's affiliate link. Never throws.
// Returns { ok: true, price, currency, inStock } or { ok: false, status, detail }
//   status: "unsupported" (host not verified) | "blocked" | "no_price" | "error"
export async function probeLivePrice(networkLink) {
  const dest = merchantUrlFromNetworkLink(networkLink);
  if (!dest || !hostAllowed(dest.hostname)) {
    return { ok: false, status: "unsupported", detail: dest ? dest.hostname : "no merchant url" };
  }
  try {
    const html = await fetchHtml(dest);
    const found = extractPriceFromHtml(html);
    if (!found) {
      // Say what we got instead (page title + size): a bot-check page and a
      // layout change look very different, and the fix differs too.
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
      return {
        ok: false,
        status: "no_price",
        detail: `no structured price; len=${html.length} title="${title.replace(/\s+/g, " ").trim().slice(0, 70)}" ld=${(html.match(/ld\+json/g) || []).length}`,
      };
    }
    return { ok: true, ...found };
  } catch (err) {
    const msg = String(err?.message || err);
    return { ok: false, status: /http (403|429|503)/.test(msg) ? "blocked" : "error", detail: msg.slice(0, 120) };
  }
}

// "₹1,119" — the format listings.price already uses for INR.
export function formatInr(n) {
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
