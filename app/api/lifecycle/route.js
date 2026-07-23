// app/api/lifecycle/route.js
//
// Resolves engagement checkpoints. POST {kind, feedback} records the
// user's answer to "why haven't you shopped?" and unlocks their current
// block — the feedback IS the price of continued free usage, and it's
// worth more than ₹249 to the business: engaged non-buyers explaining
// themselves is the highest-signal product research that exists.

import { auth } from "@clerk/nextjs/server";
import { resolveCheckpoint } from "@/lib/db";

export const maxDuration = 15;

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const kind = body.kind === "click" ? "click" : "search";
  const feedback = String(body.feedback || "").trim();
  if (feedback.length < 3) {
    return Response.json({ error: "Tell us a little — even one honest sentence helps." }, { status: 400 });
  }

  try {
    // Stored with gratitude, unlocks nothing (design 2026-07-23): the
    // recharge or a real purchase is the only key. The response says so
    // honestly rather than letting the client pretend otherwise.
    await resolveCheckpoint(userId, kind, "feedback", feedback);
    return Response.json({ ok: true, unlocked: false });
  } catch (err) {
    console.error("Checkpoint resolution failed:", err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
