// lib/conversions.js
//
// Polls the affiliate networks' transaction reports and writes the results
// onto the matching network_clicks rows — matched by the sub-ID (click_id)
// we attached on the way out. This is what turns "a click happened" into
// "this click produced this sale worth this commission", which is the basis
// for revenue analytics now and the loyalty programme later.
//
// Statuses are normalised to exactly three values, mirroring how networks
// actually settle: 'pending' (inside the return window), 'approved'
// (commission confirmed payable), 'declined' (returned / cancelled /
// deduplicated). A re-poll simply overwrites — the network's latest word
// always wins, which is how pending → approved/declined progresses.
//
// Hard-won rule #4 applies with full force here: NEVER trust the field
// names below until they have been checked against a REAL response. The
// route's ?diag=1 mode fetches a live sample from each network and reports
// its actual shape without writing anything — use it first, exactly like
// /api/admin/feeddiag for product feeds.
//
//   - Awin: documented and stable. Transactions API returns commissionStatus,
//     commissionAmount{amount,currency}, saleAmount{...}, clickRefs{clickRef}.
//     Requires AWIN_API_TOKEN — the publisher OAuth token from the Awin UI,
//     which is NOT the same credential as AWIN_DATAFEED_API_KEY.
//   - vCommission (Trackier): the conversions endpoint and the field that
//     echoes our p1 sub-param are UNVERIFIED. The adapter reads defensively
//     (several candidate field names) and the diag output will show which
//     one is real. Confirm with a test order + Ritika before trusting it.

import { updateClickConversion, logSyncRun } from "@/lib/db";

// ---------------------------------------------------------------------------
// Shared helpers

function normalizeStatus(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (["approved", "confirmed", "validated", "paid"].includes(s)) return "approved";
  if (["declined", "rejected", "cancelled", "canceled", "deleted", "reversed"].includes(s)) return "declined";
  // Everything else — including unknown strings — stays pending rather than
  // guessing a settlement that hasn't happened.
  return "pending";
}

// Reads the first present, non-empty value among several candidate paths
// ("a.b" style). Exists because the vCommission response shape is unverified.
function pick(obj, paths) {
  for (const path of paths) {
    let v = obj;
    for (const key of path.split(".")) {
      v = v?.[key];
      if (v === undefined || v === null) break;
    }
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

const toNum = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Awin

const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "2967413";

// The Transactions API caps each request at 31 days, so a longer lookback is
// fetched in chunks. Times are sent explicitly because the endpoint requires
// full timestamps, not bare dates.
async function fetchAwinTransactions(lookbackDays) {
  const token = process.env.AWIN_API_TOKEN;
  if (!token) return { skipped: "AWIN_API_TOKEN not set (this is the publisher API token from the Awin UI, not the datafeed key)" };

  const all = [];
  const end = new Date();
  let windowEnd = end;
  let remaining = lookbackDays;

  while (remaining > 0) {
    const span = Math.min(remaining, 31);
    const windowStart = new Date(windowEnd.getTime() - span * 86400000);
    const url =
      `https://api.awin.com/publishers/${AWIN_PUBLISHER_ID}/transactions/` +
      `?startDate=${encodeURIComponent(dateOnly(windowStart) + "T00:00:00")}` +
      `&endDate=${encodeURIComponent(dateOnly(windowEnd) + "T23:59:59")}` +
      `&timezone=UTC&dateType=transaction`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      throw new Error(`Awin transactions API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const batch = await resp.json();
    if (Array.isArray(batch)) all.push(...batch);

    windowEnd = windowStart;
    remaining -= span;
  }
  return { transactions: all };
}

function mapAwinTransaction(t) {
  const clickId = t?.clickRefs?.clickRef || null;
  if (!clickId) return null; // organic Awin sale or one from before the plumbing
  return {
    clickId,
    transactionId: String(t.id ?? ""),
    status: normalizeStatus(t.commissionStatus),
    orderValue: toNum(t?.saleAmount?.amount),
    commission: toNum(t?.commissionAmount?.amount),
    currency: t?.commissionAmount?.currency || t?.saleAmount?.currency || null,
  };
}

// ---------------------------------------------------------------------------
// vCommission (Trackier)
//
// The conversions endpoint is NOT documented anywhere we can trust: the
// first guess (/v2/publisher/conversions) returned 404 in production on
// 2026-07-22. So the endpoint now comes from the VCOMMISSION_CONVERSIONS_URL
// env var, and until that is set the poll SKIPS quietly instead of logging a
// red error every day. To find the real endpoint: run the route with
// ?diag=1, which probes the plausible Trackier paths and reports which one
// answers — and/or ask Ritika for the publisher conversions/report API.
// The URL may contain {apiKey}, {start} and {end} placeholders; if it has
// none, apiKey/start/end are appended as query params.

const VCOMMISSION_ENDPOINT_CANDIDATES = [
  "https://api.trackier.com/v2/publisher/conversions",
  "https://api.trackier.com/v2/publisher/report/conversions",
  "https://api.trackier.com/v2/publisher/reports/conversions",
  "https://api.trackier.com/v2/publisher/conversion",
  "https://api.trackier.com/v2/publisher/report?type=conversions",
];

function buildVcommissionUrl(template, apiKey, start, end) {
  if (/{apiKey}|{start}|{end}/.test(template)) {
    return template
      .replaceAll("{apiKey}", encodeURIComponent(apiKey))
      .replaceAll("{start}", start)
      .replaceAll("{end}", end);
  }
  const sep = template.includes("?") ? "&" : "?";
  return `${template}${sep}apiKey=${encodeURIComponent(apiKey)}&start=${start}&end=${end}`;
}

async function fetchVcommissionConversions(lookbackDays) {
  const apiKey = process.env.VCOMMISSION_API_KEY;
  if (!apiKey) return { skipped: "VCOMMISSION_API_KEY not set" };

  const template = process.env.VCOMMISSION_CONVERSIONS_URL;
  if (!template) {
    return {
      skipped:
        "VCOMMISSION_CONVERSIONS_URL not set — the Trackier conversions endpoint is unverified " +
        "(first guess 404'd). Run /api/admin/conversions?diag=1 to probe candidates, or ask " +
        "Ritika for the publisher conversions API, then set the env var.",
    };
  }

  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const url = buildVcommissionUrl(template, apiKey, dateOnly(start), dateOnly(end));

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`vCommission conversions API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const body = await resp.json();
  // The array has been seen under different keys on Trackier deployments;
  // take the first array-valued candidate.
  const rows = [body?.conversions, body?.data, body?.rows, body?.results, Array.isArray(body) ? body : null]
    .find(Array.isArray) || [];
  return { transactions: rows, rawShape: summariseShape(body) };
}

// Probes the candidate Trackier endpoints and reports what each answered —
// status code, and for a 200 the response shape. Read-only; nothing is
// written. This is how the real endpoint gets FOUND rather than guessed.
export async function probeVcommissionEndpoints({ lookbackDays = 7 } = {}) {
  const apiKey = process.env.VCOMMISSION_API_KEY;
  if (!apiKey) return { skipped: "VCOMMISSION_API_KEY not set" };
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);

  const probes = [];
  for (const candidate of VCOMMISSION_ENDPOINT_CANDIDATES) {
    const url = buildVcommissionUrl(candidate, apiKey, dateOnly(start), dateOnly(end));
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      let shape = null;
      if (resp.ok) {
        try { shape = summariseShape(JSON.parse(text)); } catch { shape = `non-JSON: ${text.slice(0, 120)}`; }
      }
      probes.push({
        endpoint: candidate,
        status: resp.status,
        ...(resp.ok ? { shape } : { body: text.slice(0, 120) }),
      });
    } catch (err) {
      probes.push({ endpoint: candidate, error: err.message });
    }
  }
  return {
    probes,
    next:
      "If one probe returned 200 with a conversions-looking shape, set VCOMMISSION_CONVERSIONS_URL " +
      "to that endpoint in Vercel (no code change needed) and re-run the poll. If none did, the " +
      "endpoint has to come from vCommission support / Ritika.",
  };
}

function mapVcommissionConversion(c) {
  // Candidate names for the echoed p1 sub-param — the diag output will show
  // which is real. Until verified, unmatched rows are simply skipped.
  const clickId = pick(c, ["p1", "sub1", "sub_id", "sub_id1", "publisher_parameters.p1", "pubParams.p1"]);
  if (!clickId) return null;
  return {
    clickId: String(clickId),
    transactionId: String(pick(c, ["id", "conversion_id", "txn_id", "transaction_id"]) ?? ""),
    status: normalizeStatus(pick(c, ["status", "conversion_status", "approval_status"])),
    orderValue: toNum(pick(c, ["sale_amount", "saleAmount", "order_value", "amount"])),
    commission: toNum(pick(c, ["payout", "commission", "publisher_payout", "earning"])),
    currency: pick(c, ["currency", "payout_currency"]) || "INR",
  };
}

// For diag mode: the shape of a response without its values, so the real
// field names can be read off and the mappers above corrected.
function summariseShape(obj, depth = 0) {
  if (depth > 2 || obj === null || typeof obj !== "object") return typeof obj;
  if (Array.isArray(obj)) return obj.length ? [summariseShape(obj[0], depth + 1)] : [];
  const out = {};
  for (const k of Object.keys(obj).slice(0, 30)) out[k] = summariseShape(obj[k], depth + 1);
  return out;
}

// ---------------------------------------------------------------------------
// The poll itself

const NETWORKS = [
  { name: "vCommission", logName: "vCommission conversions", fetcher: fetchVcommissionConversions, mapper: mapVcommissionConversion },
  { name: "Awin", logName: "Awin conversions", fetcher: fetchAwinTransactions, mapper: mapAwinTransaction },
];

export async function pollConversions({ lookbackDays = 45 } = {}) {
  const results = [];

  for (const net of NETWORKS) {
    // Distinct log names (rule #6): the status panel does DISTINCT ON
    // (network), so these must never share a name with the product syncs.
    let seen = 0, matched = 0, skippedNoSubId = 0;
    try {
      const { transactions, skipped } = await net.fetcher(lookbackDays);
      if (skipped) {
        results.push({ network: net.name, skipped });
        continue;
      }
      seen = transactions.length;
      for (const t of transactions) {
        const mapped = net.mapper(t);
        if (!mapped) { skippedNoSubId++; continue; }
        const updated = await updateClickConversion(mapped);
        if (updated) matched++;
      }
      await logSyncRun({
        network: net.logName,
        status: "success",
        productsSeen: seen,              // = transactions fetched
        newListings: matched,            // = transactions matched to a click
        updatedListings: skippedNoSubId, // = transactions without our sub-ID
      });
      results.push({ network: net.name, seen, matched, withoutSubId: skippedNoSubId });
    } catch (err) {
      console.error(`${net.name} conversion poll failed:`, err.message);
      await logSyncRun({ network: net.logName, status: "error", productsSeen: seen, newListings: matched, updatedListings: 0, errorMessage: err.message }).catch(() => {});
      results.push({ network: net.name, error: err.message });
    }
  }

  return results;
}

// Diag: live sample from each network, no writes. The whole point is to
// validate real field names before trusting the mappers (rule #4). While
// VCOMMISSION_CONVERSIONS_URL is unset, this also probes the candidate
// Trackier endpoints so the real one can be found and set.
export async function diagConversions({ lookbackDays = 31 } = {}) {
  const out = {};
  for (const net of NETWORKS) {
    try {
      const { transactions, skipped, rawShape } = await net.fetcher(lookbackDays);
      out[net.name] = skipped
        ? { skipped }
        : {
            count: transactions.length,
            shape: rawShape || (transactions.length ? summariseShape(transactions[0]) : "no transactions in window"),
            firstMapped: transactions.length ? net.mapper(transactions[0]) : null,
          };
    } catch (err) {
      out[net.name] = { error: err.message };
    }
  }
  if (!process.env.VCOMMISSION_CONVERSIONS_URL) {
    out.vcommissionEndpointProbe = await probeVcommissionEndpoints();
  }
  return out;
}
