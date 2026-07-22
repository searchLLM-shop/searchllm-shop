// lib/vouchers.js
//
// Voucher issuance abstraction. Two providers:
//
//   manual  (DEFAULT, working today): an admin buys the voucher and pastes
//           the code into the redemption queue. Zero integration risk.
//
//   woohoo  (SCAFFOLD): Woohoo (developers.woohoo.in, the Qwikcilver/Pen
//           India gift-card platform) exposes a B2B API for programmatic
//           issuance across brands (Amazon Pay, Flipkart, Myntra, Swiggy).
//           Access requires a signed commercial agreement and credentials.
//           HARD-WON RULE #4 APPLIES: this adapter is deliberately NOT
//           implemented against guessed endpoints. When the Woohoo account
//           exists, take their actual API docs + sandbox credentials and
//           implement issueVoucher() against REAL responses. Their
//           dashboard also provides the provider-side redemption reports;
//           getRewardsReport() in lib/db.js is the internal ground truth
//           to reconcile against.
//
// Required env (when woohoo goes live): VOUCHER_PROVIDER=woohoo,
// WOOHOO_CLIENT_ID, WOOHOO_CLIENT_SECRET, WOOHOO_BASE_URL (sandbox first).

export function voucherProvider() {
  return process.env.VOUCHER_PROVIDER === "woohoo" ? "woohoo" : "manual";
}

export async function issueVoucher({ brand, denominationInr, redemptionId }) {
  if (voucherProvider() === "manual") {
    return { issued: false, reason: "manual provider — fulfil from the admin queue" };
  }
  // Woohoo path: refuse loudly rather than pretend, until implemented
  // against their real documentation and sandbox.
  throw new Error(
    "Woohoo adapter not implemented: requires B2B credentials and verified API docs. " +
    "Set VOUCHER_PROVIDER=manual (default) to use the admin fulfilment queue."
  );
}
