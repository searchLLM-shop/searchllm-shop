// lib/publicationGate.js
//
// Separates CORPUS membership from INDEX membership. Every answered query
// keeps feeding the engine; only a qualifying minority earns a URL, a
// sitemap entry and index,follow.
//
// The reasoning: Google's 2026 enforcement against scaled content abuse
// applies a SITEWIDE demotion when a large share of a domain's URLs read as
// unhelpful — and recovery takes many months. A small set of substantive
// pages outperforms a large set of summaries, so the gate should feel
// uncomfortably strict. The instinct to loosen it because the pass rate
// looks low is the exact instinct that gets domains demoted.
//
// Pure and side-effect free so it can be unit tested and so gate_result can
// be recorded for every draft — including failures, which is where the
// tuning information lives.

import crypto from "crypto";

export const GATE = {
  minAnswerWords: 250,
  minAlternatives: 2,        // a page with nothing compared is a summary
  requireSearch: true,       // no live retrieval → no original evidence
  maxSimilarity: 0.86,       // near-duplicate ceiling vs published pages
  allowedTaskTypes: ["research", "technical", "analysis"],
  // Cosmic layer (2026-08-19): a topic only earns a public URL if the
  // synthesis model judged real demand for it, not just because it happened
  // to pass every other check. Levels that block publication.
  blockedPopularity: ["low", "niche"],
};

// Normalised hash of the answer body — catches exact regeneration of the
// same content, which similarity scoring would also catch but this is free.
export function contentHash(text) {
  const normalised = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ₹]/g, "")
    .trim();
  return crypto.createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

function tokenSet(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

// Jaccard overlap. Deliberately not embeddings: at a few hundred pages the
// signal we need is "is this substantially the same page", and word overlap
// answers that without a vector store. Revisit if the corpus reaches
// thousands of published pages.
export function similarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

// published: [{ id, slug, text }] — existing published pages to compare
// against. Compare against PUBLISHED only: the corpus is allowed to hold
// near-duplicates, the index is not.
export function evaluateGate(draft, published = []) {
  const text = [draft.headline, draft.body, draft.whoFor, draft.whoSkip]
    .filter(Boolean)
    .join(" ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const alternatives = Array.isArray(draft.alternatives) ? draft.alternatives.length : 0;
  const hash = contentHash(text);

  let maxSimilarity = 0;
  let nearestSlug = null;
  for (const p of published) {
    if (p.id === draft.id) continue;
    const s = similarity(text, p.text);
    if (s > maxSimilarity) {
      maxSimilarity = s;
      nearestSlug = p.slug;
    }
  }
  const hashCollision = published.some((p) => p.id !== draft.id && p.contentHash && p.contentHash === hash);

  const checks = {
    live_retrieval: GATE.requireSearch ? draft.searchPerformed === true : true,
    substance: words >= GATE.minAnswerWords,
    comparison: alternatives >= GATE.minAlternatives,
    task_type: GATE.allowedTaskTypes.includes(draft.taskType || "research"),
    novelty: maxSimilarity < GATE.maxSimilarity && !hashCollision,
    // null/missing (every draft written before this check existed, or any
    // run where the model didn't return a valid value) means "unknown" —
    // treated as a pass so this can never retroactively block an
    // already-in-flight draft. Only an explicit low/niche judgment blocks.
    popularity: draft.popularityLevel == null || !GATE.blockedPopularity.includes(draft.popularityLevel),
  };

  const failedOn = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    passed: failedOn.length === 0,
    checks,
    metrics: {
      words,
      alternatives,
      maxSimilarity: Math.round(maxSimilarity * 100) / 100,
      nearestSlug,
      searchPerformed: draft.searchPerformed === true,
      popularityLevel: draft.popularityLevel || null,
    },
    failedOn,
    contentHash: hash,
    evaluatedAt: new Date().toISOString(),
  };
}

// Human-readable reasons, for the admin queue.
export const GATE_REASONS = {
  live_retrieval: "No live web retrieval backed this answer — it's written from model memory alone.",
  substance: `Answer is under ${GATE.minAnswerWords} words — too thin to earn an indexed page.`,
  comparison: `Fewer than ${GATE.minAlternatives} alternatives considered — reads as a summary, not research.`,
  task_type: "Task type isn't one we index (research, technical, analysis only).",
  novelty: "Too similar to a page already published — near-duplicate sets are a spam signal.",
  popularity: "The model judged this a low-demand or niche topic — not worth an indexed page even though the answer itself passed every other check.",
};
