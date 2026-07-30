// app/api/whatsapp/webhook/route.js
//
// The WhatsApp channel. A user messages the business number → Meta POSTs
// here → the SAME pipeline as the website runs (content filter → candidate
// retrieval → mechanical shortlist → model chooses the one genuinely
// suitable sponsored product or none) → the answer goes back as a chat
// message, with the sponsored link routed through /out/ so click tracking,
// conversions, and (one day) points work identically. Identity is
// "wa:{phone}" — more durable than any guest cookie.
//
// Design constraints honoured:
//   - Meta expects a fast 200; research takes seconds. We ACK immediately
//     and do the work via waitUntil, with DB-backed dedupe (wa_processed)
//     because Meta retries anything it thinks failed.
//   - Signature verification is mandatory (see lib/whatsapp.js).
//   - The 24h service window: we only ever REPLY to user messages, never
//     initiate, so every message is free-form-permitted by design.
//   - Same content policy: blocked queries get the same honest category
//     messages; restricted images are refused by the same vision gate.

import { waitUntil } from "@vercel/functions";
import { verifySignature, sendText, downloadMedia, formatAnswer, whatsappConfigured } from "@/lib/whatsapp";
import { checkQuery } from "@/lib/contentFilter";
import { identifyProductFromImage } from "@/lib/visionSearch";
import { findCandidateListings, query as dbQuery, getUsageToday, getAndIncrementUsage, recordSearchQuery } from "@/lib/db";
import { findTopMatchingListings, extractQueryTerms, buildClientListingPayload } from "@/lib/listingMatcher";

// Public origin for links in replies. Set NEXT_PUBLIC_SITE_URL in Vercel;
// falls back to the production domain.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://searchllm.shop";

export const maxDuration = 60;

const WA_DAILY_LIMIT = 8; // same free quota as the web

// Compact channel prompt. The web prompt's hard-won calibration rules are
// carried over verbatim where they matter: budget-is-a-ceiling, choose only
// from offered ids, the solid-buy bar, restricted categories, and the
// adult-context minors rule. Format rules differ because the channel does.
const WA_SYSTEM_PROMPT = `You are SearchLLM answering a shopping question over WhatsApp. Your reputation rests on honesty, not affiliate revenue.

Answer in compact chat form. Respond ONLY with valid JSON, no markdown fences:
{
  "headline": "one short sentence naming the real decision",
  "body": "2-4 tight sentences of honest guidance. WhatsApp-length, not essay-length.",
  "goodFor": "one clause",
  "skipIf": "one clause",
  "sponsoredChoiceId": id or null,
  "alternatives": [{"name": "...", "priceRange": "₹X–₹Y"}] (max 3)
}

sponsoredChoiceId rules (identical to the website): ONLY an id from the offered list, or null. A stated budget is a CEILING — priced-under still qualifies; "around X" names a price class. The bar is "would a knowledgeable friend call this a solid buy for what was asked", NOT "is it the market's best" — market comparisons go in the body text, they are never a reason to suppress a genuinely good offered product. If you find yourself writing "solid products, but…", select the best and put the but in the body. Null is for wrong type, over budget, or products too poor to endorse.

Restricted categories — do not answer, say briefly we don't cover it: medicines of any kind (doctor/pharmacist matter), weapons, tobacco/vaping, gambling, alcohol purchase, adult products or services, dating apps. Sexual-wellness health products (condoms, lubricants, intimate hygiene) are fully supported. If the query has sexual or suggestive language, never mention children, kids' products, or minors anywhere in the answer.

Never use the double-quote inch symbol (") inside strings — write 55-inch.`;

// GET: Meta's webhook verification handshake at setup time.
export async function GET(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req) {
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new Response("Bad signature", { status: 401 });
  }
  if (!whatsappConfigured()) return Response.json({ ok: true }); // ack, do nothing

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return Response.json({ ok: true }); }

  // Extract user messages (statuses/read receipts also arrive here — ignored).
  const messages = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) messages.push(msg);
    }
  }

  if (messages.length) {
    // ACK now, work after — Meta retries slow webhooks, and duplicate
    // replies to a shopper are worse than no reply.
    waitUntil(Promise.allSettled(messages.map((m) => handleMessage(m))));
  }
  return Response.json({ ok: true });
}

async function handleMessage(msg) {
  const from = msg.from; // E.164 without '+'
  if (!from || !msg.id) return;

  // DB-backed dedupe: first writer wins, retries no-op.
  const dedupe = await dbQuery(
    `INSERT INTO wa_processed (message_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [msg.id]
  );
  if (dedupe.rowCount === 0) return;

  const identity = `wa:${from}`;

  try {
    // --- Extract the question (text, or image ± caption) ---
    let queryText = "";
    let attachment = null;
    if (msg.type === "text") queryText = msg.text?.body || "";
    else if (msg.type === "image") {
      queryText = msg.image?.caption || "";
      try {
        attachment = await downloadMedia(msg.image.id);
      } catch (e) {
        await sendText(from, "Couldn't read that image — try a smaller photo, or just type your question.");
        return;
      }
    } else {
      await sendText(from, "Send me a shopping question as text (or a product photo) — e.g. *ubtan face wash under ₹300 for oily skin* — and I'll research an honest pick for you.");
      return;
    }

    // --- Content policy, same gates as the web ---
    const contentCheck = checkQuery(queryText);
    if (contentCheck.blocked) {
      await sendText(from, contentCheck.reason);
      return;
    }

    // --- Quota, same daily allowance as web guests ---
    const used = await getUsageToday(identity);
    if (used >= WA_DAILY_LIMIT) {
      await sendText(from, `That's your ${WA_DAILY_LIMIT} picks for today — the counter resets at midnight UTC. Your questions are welcome again tomorrow, or research without limits at ${SITE_URL}.`);
      return;
    }

    // --- Vision (with the image content gate) ---
    let vision = null;
    if (attachment) {
      vision = await identifyProductFromImage(attachment);
      if (vision?.restricted) {
        await sendText(from, "We can't process this image. Send a clear photo of a product you'd like researched.");
        return;
      }
      const derived = `${vision?.productType || ""} ${vision?.description || ""}`.trim();
      if (derived) {
        const imageCheck = checkQuery(derived);
        if (imageCheck.blocked) { await sendText(from, imageCheck.reason); return; }
      }
    }

    const matchText = [queryText, vision?.productType, vision?.description].filter(Boolean).join(" ");
    if (!matchText.trim()) {
      await sendText(from, "Tell me what you're shopping for — product, what matters to you, and a budget works best.");
      return;
    }

    // --- Retrieval → shortlist, identical machinery ---
    const terms = extractQueryTerms(matchText);
    const candidates = terms.length ? await findCandidateListings(terms, "IN") : [];
    const topMatches = findTopMatchingListings(matchText, candidates, "IN", 8);

    if (queryText.trim()) {
      recordSearchQuery({
        queryText,
        matched: topMatches.length > 0,
        listingId: topMatches[0]?.listing.id || null,
        network: null,
        country: "IN",
      }).catch(() => {});
    }

    // --- The model call ---
    const userContent = `${queryText || `The person sent a photo of: ${vision?.description || "a product"}`}${
      topMatches.length
        ? `\n\nThe following partner products exist in our inventory and MIGHT be relevant:\n${topMatches
            .map((m, i) => `${i + 1}. [id ${m.listing.id}] ${m.listing.product} by ${m.listing.brand}, ${m.listing.price}${m.listing.rating ? `, rated ${m.listing.rating}/5 by ${m.listing.ratingCount || "some"} shoppers` : ""}`)
            .join("\n")}\nJudge each exactly as you would if no money were involved. Choose the ONE that genuinely answers the question, or none.`
        : ""
    }`;

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        temperature: 0.2,   // same reproducibility rule as the web channel
        system: WA_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!apiResp.ok) throw new Error(`Anthropic API ${apiResp.status}`);
    const completion = await apiResp.json();

    let raw = (completion.content?.[0]?.text || "").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Same inch-mark repair as the web route — screen sizes break JSON.
      parsed = JSON.parse(raw.replace(/(\d)\s*"(?=\s*[^,}\]:\s]|\s+[a-zA-Z+&(₹])/g, "$1-inch"));
    }

    // --- Sponsored choice: only offered ids accepted, same guard ---
    const offeredIds = new Set(topMatches.map((m) => m.listing.id));
    let chosenId = Number(parsed.sponsoredChoiceId);
    if (!offeredIds.has(chosenId)) chosenId = null;
    const chosenFull = chosenId ? candidates.find((l) => l.id === chosenId) || null : null;
    const client = buildClientListingPayload(chosenFull);

    let sponsored = null;
    if (chosenFull && client) {
      // The /out/ redirect carries identity + context, so this click lands
      // in network_clicks like any web click — conversions and points
      // attribution work without a single change.
      const link = `${SITE_URL}/out/${chosenFull.id}?i=${encodeURIComponent(identity)}&c=whatsapp`;
      sponsored = { product: chosenFull.product, price: chosenFull.price, network: chosenFull.network, link };
    }

    await getAndIncrementUsage(identity);

    await sendText(from, formatAnswer({
      headline: parsed.headline,
      body: parsed.body,
      goodFor: parsed.goodFor,
      skipIf: parsed.skipIf,
      sponsored,
      alternatives: parsed.alternatives,
    }));
  } catch (err) {
    console.error("WhatsApp handling failed:", err);
    try {
      await sendText(from, "Something went wrong researching that — give it another try in a minute.");
    } catch {}
  }
}
