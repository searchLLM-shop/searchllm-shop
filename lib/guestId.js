// lib/guestId.js
//
// Anonymous (guest) users need a stable identity for quota tracking that
// isn't shared across every visitor. We use a random ID stored in a
// long-lived, httpOnly cookie. This is NOT a tracking mechanism in the
// profiling sense — it's discarded with no linkage to any other data,
// exactly as described in the Privacy Policy ("session token, not linked
// to identity"). It exists only so the daily search counter is per-visitor
// instead of global.

import { cookies } from "next/headers";
import { randomUUID } from "crypto";

const COOKIE_NAME = "sllm_guest_id";

export async function getOrCreateGuestId() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = `guest_${randomUUID()}`;
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90, // 90 days
    path: "/",
  });
  return id;
}
