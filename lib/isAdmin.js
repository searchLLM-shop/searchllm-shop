// lib/isAdmin.js
//
// Single source of truth for "is this user an admin". Used by the admin
// routes and by the quota check, so admins can test the product without
// burning through the free daily limit.

export function isAdminEmail(email) {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
