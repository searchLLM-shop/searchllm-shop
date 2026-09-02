// lib/isAdmin.js
//
// Single source of truth for "is this user an admin". Used by the admin
// routes and by the quota check, so admins can test the product without
// burning through the free daily limit.
//
// Phone-based admin recognition added 2026-09-02: sign-up is moving to
// phone-number-only (no email collected at sign-up any more — see
// lib/constants.js), so an admin account may have no email address at
// all. isAdminEmail is kept as-is (still checks ADMIN_EMAILS, for any
// admin accounts that do have one on file) and isAdminPhone is the phone
// equivalent, checking the new ADMIN_PHONES env var. isAdminUser is the
// one every route should actually call now — it takes the Clerk `user`
// object straight from currentUser() and checks both, so an admin
// recognized by either identifier gets in.

export function isAdminEmail(email) {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

// Compares by the last 10 digits so it doesn't matter whether the number
// in ADMIN_PHONES or on the Clerk account is written as "8595870721",
// "+918595870721", or with spaces/dashes — all of those normalise the same.
function last10Digits(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

export function isAdminPhone(phone) {
  const digits = last10Digits(phone);
  if (!digits) return false;
  const admins = (process.env.ADMIN_PHONES || "")
    .split(",")
    .map((p) => last10Digits(p))
    .filter(Boolean);
  return admins.includes(digits);
}

// Takes the Clerk user object directly (from currentUser()) — every admin
// route should call this rather than isAdminEmail alone now, since an
// admin's account may be identified by phone, email, or (during the
// migration window) either.
export function isAdminUser(user) {
  if (!user) return false;
  return (
    isAdminEmail(user.emailAddresses?.[0]?.emailAddress) ||
    isAdminPhone(user.phoneNumbers?.[0]?.phoneNumber)
  );
}
