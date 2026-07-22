// lib/whatsapp.js
//
// WhatsApp Business Cloud API client. Verified design facts (check current
// Meta docs — pricing/versions move): user-initiated messages open a 24h
// "service window" in which free-form replies are permitted; this product
// lives entirely inside that window (someone asks, we answer), which is
// both the compliant and the economical mode. Outside-window messaging
// needs approved templates — deliberately NOT used here.
//
// Required env:
//   WHATSAPP_ACCESS_TOKEN     permanent token (Meta system user)
//   WHATSAPP_PHONE_NUMBER_ID  the business number's id (not the number)
//   WHATSAPP_VERIFY_TOKEN     any secret string; echoed at webhook setup
//   WHATSAPP_APP_SECRET       app secret, for X-Hub-Signature-256 checks

import crypto from "crypto";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

// Every webhook POST is HMAC-signed with the app secret. Rejecting bad
// signatures is not optional: an unauthenticated webhook is an open door
// for forged "user messages" that would burn API spend and could be used
// to spam arbitrary phone numbers through our sender.
export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function sendText(to, body) {
  const resp = await fetch(`${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      // preview_url so the sponsored /out link renders a tappable preview
      text: { body: body.slice(0, 4096), preview_url: true },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`WhatsApp send failed ${resp.status}: ${err.slice(0, 300)}`);
  }
  return resp.ok;
}

// Incoming image messages carry a media id; the bytes come from a two-step
// fetch (id → short-lived URL → download). Returns base64 + mime for the
// existing vision pipeline, which also runs the image content gate.
export async function downloadMedia(mediaId) {
  const meta = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!meta.ok) throw new Error(`media meta ${meta.status}`);
  const { url, mime_type } = await meta.json();
  const bin = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!bin.ok) throw new Error(`media download ${bin.status}`);
  const buf = Buffer.from(await bin.arrayBuffer());
  if (buf.length > 3_000_000) throw new Error("media too large");
  return { data: buf.toString("base64"), mediaType: mime_type };
}

// WhatsApp formatting: *bold*, _italic_, no headers, hard length budget.
// A chat answer should read in one screen — this is a feature of the
// channel, not a limitation: same honesty, tighter prose.
export function formatAnswer({ headline, body, goodFor, skipIf, sponsored, alternatives }) {
  const parts = [];
  if (headline) parts.push(`*${headline.trim()}*`);
  if (body) parts.push(body.trim());
  if (goodFor) parts.push(`✅ *Good for:* ${goodFor.trim()}`);
  if (skipIf) parts.push(`⚠️ *Skip if:* ${skipIf.trim()}`);
  if (sponsored) {
    parts.push(
      `🛒 *${sponsored.product}* — ${sponsored.price}\n${sponsored.link}\n_Sponsored · affiliate link via ${sponsored.network}. Never changes your price, never the reason it was suggested._`
    );
  }
  if (alternatives?.length) {
    parts.push(
      `*Also considered (no affiliate relationship):*\n` +
        alternatives.slice(0, 3).map((a) => `• ${a.name} — ${a.priceRange || ""}`).join("\n")
    );
  }
  parts.push(`_AI can make mistakes — verify price and specs on the retailer's page. searchllm.shop_`);
  return parts.join("\n\n");
}
