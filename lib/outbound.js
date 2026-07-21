// lib/outbound.js
//
// Builds the final outbound affiliate URL for a click, injecting our
// click_id as the network's sub-ID / clickref parameter. The network echoes
// this value back in its transaction reports, which is the entire basis of
// per-click conversion attribution: without the echo we'd be guessing which
// click produced which sale.
//
// Kept deliberately tiny and in one file because the parameter NAMES are the
// risky part. Per hard-won rule #4 (validate against REAL responses, never
// documentation): the Awin `clickref` parameter is well-documented and comes
// back in the Transactions API as clickRefs.clickRef. The vCommission/
// Trackier `p1` parameter is the platform's documented publisher sub-param,
// but it has NOT yet been verified against a live conversion report —
// do that before building anything (points, payouts) on top of it:
// place a test order through a p1-tagged link, then confirm the value
// appears in the conversion report / API. Ask Ritika which report field
// carries it. Until then the click still redirects fine (unknown query
// params are ignored by the tracker) and our own click row is still logged.

const SUB_ID_PARAM = {
  awin: "clickref",
  vcommission: "p1", // UNVERIFIED against a live conversion — see header note
};

/**
 * Returns the outbound URL string with the click_id attached, or null when
 * the stored link is not a valid URL (in which case the caller should fall
 * back to the raw link rather than dropping the shopper).
 */
export function buildOutboundUrl(networkLink, network, clickId) {
  let url;
  try {
    url = new URL(networkLink);
  } catch {
    return null;
  }
  const param = SUB_ID_PARAM[String(network || "").trim().toLowerCase()];
  // Networks we don't have a sub-ID convention for still get the redirect
  // and the click row — just no conversion attribution yet.
  if (param && clickId) url.searchParams.set(param, clickId);
  return url.toString();
}
