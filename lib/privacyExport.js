// lib/privacyExport.js
//
// Compiles the actual "copy of your data" a DPDP access request
// promises — used by the admin Privacy requests panel's Export button
// (app/api/admin/privacy-requests/export/route.js). Pulls every table
// that holds data actually linked to one clerk_user_id, decrypts the
// PII fields (same encryptPII/decryptPII as everywhere else in this
// codebase), and returns one structured object to download as JSON and
// hand to the requester.
//
// Deliberately excludes tables that don't carry THIS person's personal
// data even though they mention users in passing: search_queries is
// anonymous by design (no identifier attached, ever — the entire point
// of that table); ip_activity/alt_clicks are hashed-IP-keyed, not
// identity-keyed. Also excludes localStorage-only client data (saved
// picks) — that never reaches our servers, so there's nothing here to
// export; the requester already has it in their own browser.
//
// A separate top-level module (not inside lib/db.js) so this
// export-compilation code stays in one place, apart from the core data
// layer.

import { query, getMarketingConsent } from "@/lib/db";
import { decryptPII } from "@/lib/piiCrypto";
import { clerkClient } from "@clerk/nextjs/server";

export async function compileUserDataExport(clerkUserId) {
  const [
    identityRows,
    pointsLedger,
    redemptions,
    checkpoints,
    referralCode,
    referralsMade,
    watches,
    alerts,
    privacyRequests,
    marketingConsent,
  ] = await Promise.all([
    query(`SELECT phone_encrypted, created_at FROM user_identities WHERE clerk_user_id = $1`, [clerkUserId]),
    query(
      `SELECT id, points, status, commission, currency, network, source, note, created_at, updated_at
       FROM points_ledger WHERE user_id = $1 ORDER BY created_at DESC`,
      [clerkUserId]
    ),
    query(
      `SELECT id, points, voucher_type, status, voucher_code,
              kyc_first_name, kyc_last_name, kyc_mobile, kyc_email, kyc_address, kyc_confirmed_at,
              created_at, fulfilled_at
       FROM redemptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [clerkUserId]
    ),
    query(
      `SELECT kind, block_number, status, feedback, created_at
       FROM user_checkpoints WHERE user_id = $1 ORDER BY created_at DESC`,
      [clerkUserId]
    ),
    query(`SELECT code, created_at FROM referral_codes WHERE user_id = $1`, [clerkUserId]),
    query(
      `SELECT referred_user_id, points, created_at FROM referrals WHERE referrer_user_id = $1 ORDER BY created_at DESC`,
      [clerkUserId]
    ),
    // The price-watchlist feature was removed (2026-10-04) but the rows
    // remain in the database, so they are still part of what we hold about
    // the requester and must stay in their export.
    query(
      `SELECT w.listing_id AS "listingId", l.brand, l.product,
              w.baseline_price_text AS "baselinePriceText", w.target_price AS "targetPrice",
              w.active, w.created_at AS "createdAt"
       FROM price_watches w JOIN listings l ON l.id = w.listing_id
       WHERE w.identity = $1 ORDER BY w.created_at DESC`,
      [clerkUserId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT a.listing_id AS "listingId", l.brand, l.product, a.old_price AS "oldPrice",
              a.new_price AS "newPrice", a.channel, a.created_at AS "createdAt"
       FROM price_alerts a JOIN listings l ON l.id = a.listing_id
       WHERE a.identity = $1 ORDER BY a.created_at DESC LIMIT 500`,
      [clerkUserId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT request_type, status, note, created_at, resolved_at
       FROM privacy_requests WHERE clerk_user_id = $1 ORDER BY created_at DESC`,
      [clerkUserId]
    ),
    getMarketingConsent(clerkUserId),
  ]);

  let clerkUser = null;
  try {
    const client = await clerkClient();
    clerkUser = await client.users.getUser(clerkUserId);
  } catch {
    // Deleted/unreachable Clerk user — export still proceeds with our own data.
  }

  return {
    generatedAt: new Date().toISOString(),
    clerkUserId,
    account: {
      username: clerkUser?.username || null,
      accountCreatedAt: clerkUser?.createdAt ? new Date(clerkUser.createdAt).toISOString() : null,
      isAdmin: clerkUser?.publicMetadata?.isAdmin === true,
      phone: identityRows.rows[0] ? decryptPII(identityRows.rows[0].phone_encrypted) : null,
      phoneOnFileSince: identityRows.rows[0]?.created_at || null,
    },
    pointsLedger: pointsLedger.rows,
    redemptions: redemptions.rows.map((r) => ({
      ...r,
      voucher_code: decryptPII(r.voucher_code),
      kyc_first_name: decryptPII(r.kyc_first_name),
      kyc_last_name: decryptPII(r.kyc_last_name),
      kyc_mobile: decryptPII(r.kyc_mobile),
      kyc_email: decryptPII(r.kyc_email),
      kyc_address: decryptPII(r.kyc_address),
    })),
    platformFeeCheckpoints: checkpoints.rows,
    referralCode: referralCode.rows[0] || null,
    referralsMade: referralsMade.rows,
    priceWatchlist: watches.rows,
    priceAlerts: alerts.rows,
    privacyRequestHistory: privacyRequests.rows,
    promotionalMessageConsent: marketingConsent,
  };
}
