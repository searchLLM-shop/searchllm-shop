// app/api/testimonials/route.js
//
// Member testimonials.
//   GET            -> approved testimonials (public, for the homepage). No
//                     identifiers: rating, comment and the display name the
//                     member chose.
//   GET ?mine=1    -> the signed-in member's own submission and its status.
//   POST           -> signed-in members only; one per member, resubmitting
//                     replaces it and sends it back for review. Nothing shows
//                     publicly until an admin approves it.

import { auth } from "@clerk/nextjs/server";
import { upsertTestimonial, getTestimonialForUser, listApprovedTestimonials } from "@/lib/db";

export async function GET(req) {
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  if (mine) {
    const { userId } = await auth();
    if (!userId) return Response.json({ testimonial: null }, { status: 401 });
    try {
      return Response.json({ testimonial: await getTestimonialForUser(userId) });
    } catch (err) {
      console.error("Own testimonial read failed:", err.message);
      return Response.json({ testimonial: null });
    }
  }
  try {
    const testimonials = await listApprovedTestimonials(6);
    return Response.json(
      { testimonials },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    console.error("Approved testimonials read failed:", err.message);
    return Response.json({ testimonials: [] });
  }
}

export async function POST(req) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to leave a review." }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: "Choose a rating from 1 to 5." }, { status: 400 });
  }
  const comment = String(body.comment || "").replace(/\s+/g, " ").trim();
  if (comment.length < 10) return Response.json({ error: "Please write at least a sentence." }, { status: 400 });
  if (comment.length > 500) return Response.json({ error: "Please keep it under 500 characters." }, { status: 400 });
  if (body.consent !== true) {
    return Response.json({ error: "Please tick the box to allow us to show your review publicly." }, { status: 400 });
  }
  const displayName = String(body.displayName || "").replace(/\s+/g, " ").trim().slice(0, 40) || null;

  try {
    const saved = await upsertTestimonial({ userId, rating, comment, displayName });
    return Response.json({ ok: true, status: saved.status });
  } catch (err) {
    console.error("Testimonial save failed:", err.message);
    return Response.json({ error: "Could not save your review. Please try again." }, { status: 500 });
  }
}
