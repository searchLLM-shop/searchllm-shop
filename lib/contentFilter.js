// lib/contentFilter.js
//
// Blocks queries that fall outside what this service supports, as set out in
// the Terms of Use, and exports the listing-side filter that keeps the same
// categories out of sponsored matching even when such products exist in the
// approved inventory (bulk feed approvals don't read every title).
//
// DESIGN NOTE — deliberately narrow, not maximal.
// A crude blocklist does real damage on a shopping site. Legitimate shoppers
// search for condoms, menstrual cups, breast pumps, lubricants for medical
// dryness, and intimate hygiene products — these are ordinary health and
// personal-care purchases, and one of our own affiliate merchants (Sirona)
// sells exactly this category. Blocking them would be both commercially
// self-defeating and quietly insulting to the person asking. The same logic
// protects "beer mug", "toy sword", "kids school bag", and paracetamol
// (OTC in India) — ambiguous words stay allowed; the model itself declines
// anything a keyword filter misses.
//
// POLICY (product decision, 2026-07-22): we do not research, answer, or
// match products in these categories, each with its own honest message:
//   - medicines of ANY kind, OTC included (policy decision 2026-07-22:
//     health decisions are for doctors and pharmacists, full stop; the line
//     is medicine-vs-not, with vitamins/supplements/personal care allowed)
//   - weapons and ammunition
//   - tobacco, vaping, gambling/betting, and direct alcohol purchase
//   - explicit adult products/services, and dating apps
// Sexual-wellness HEALTH products remain allowed, per the note above.
// Anything sexual in proximity to minors is blocked outright — see below.

// --- Minor protection ------------------------------------------------------
// Hard rule, checked FIRST: sexualised context co-occurring with any
// reference to minors is blocked with a generic message, no elaboration.
// Kept at the pattern level on purpose.
const MINOR_TERMS = [
  "child", "children", "kid", "kids", "minor", "minors", "underage",
  "teen", "teens", "teenager", "teenagers", "school girl", "school boy",
  "schoolgirl", "schoolboy",
];
const SEXUAL_CONTEXT = ["sexual", "sexy", "nude", "naked", "erotic", "adult", "intimate", "lingerie", "seductive"];

// Query-side adult-context test, exported for the matcher: when a query
// carries sexual/suggestive language, products for children must be
// structurally absent from the shortlist — not merely rejected by the
// model, because a rejection still gets EXPLAINED, and an answer that
// discusses kids' clothing under a sexualised query is itself the harm.
// Production incident, 2026-07-22: "sexy dress for a party" shortlisted
// eight girls' party dresses; the model refused all of them and then
// narrated why, juxtaposing "sexy" with children's sections. Never again.
export function hasAdultContext(text) {
  const t = (text || "").toLowerCase();
  return SEXUAL_CONTEXT.some((term) => containsTerm(t, term));
}

const MINOR_LISTING_TERMS = [
  "girl", "girls", "boy", "boys", "kid", "kids", "child", "children",
  "minor", "minors", "teen", "teens", "teenager", "teenagers",
  "infant", "toddler", "school",
];
export function mentionsMinors(text) {
  const t = (text || "").toLowerCase();
  return MINOR_LISTING_TERMS.some((term) => containsTerm(t, term));
}

// --- Restricted categories, each with its own message ------------------------
const RESTRICTED_CATEGORIES = [
  {
    name: "medicines",
    message:
      "We don't research or recommend medicines of any kind — over-the-counter or prescription. Health decisions belong with a doctor or a licensed pharmacist, not a shopping engine. Non-medicinal wellness products (vitamins, supplements, personal care) we're happy to help with.",
    terms: [
      // generic medicine intent
      "medicine", "medicines", "medication", "medications", "pharmacy", "pharmaceutical",
      "pain killer", "painkiller", "painkillers", "fever medicine", "cold medicine",
      "cough syrup", "eye drops", "ear drops", "nasal spray",
      // Ointments ARE blocked (decision 2026-07-22): they are medicinal
      // topicals where wrong AI guidance carries real harm. Antiseptic
      // liquids (Dettol/Savlon) and mouthwash stay allowed as household
      // hygiene. Pain-relief drug brands (Volini/Moov/Iodex/Vicks) stay
      // blocked as licensed OTC drugs.
      "ointment", "ointments", "ors", "homeopathic medicine", "ayurvedic medicine",
      // common OTC brands/actives (India)
      "paracetamol", "crocin", "dolo", "combiflam", "disprin", "aspirin",
      "ibuprofen", "cetirizine", "antacid", "digene", "vicks", "vaporub",
      "iodex", "volini", "moov", "zandu balm", "pain balm",
      // prescription classes and named drugs
      "prescription medicine", "prescription medicines", "prescription drug", "prescription drugs",
      "antibiotic", "antibiotics", "amoxicillin", "azithromycin", "ciprofloxacin", "doxycycline",
      "insulin", "ozempic", "semaglutide", "wegovy", "mounjaro", "weight loss injection",
      "viagra", "sildenafil", "tadalafil", "cialis",
      "tramadol", "codeine", "oxycodone", "opioid", "opioids",
      "alprazolam", "xanax", "diazepam", "valium", "sleeping pills", "sedative", "sedatives",
      "antidepressant", "antidepressants", "sertraline", "fluoxetine",
      "isotretinoin", "accutane", "anabolic steroids", "steroids for muscle",
      "abortion pill", "abortion pills", "mifepristone", "misoprostol",
    ],
  },
  {
    name: "weapons",
    message: "We don't cover weapons or ammunition. Try a different shopping question.",
    terms: [
      "handgun", "pistol", "revolver", "buy gun", "buy rifle", "rifle for sale",
      "ammunition", "bullets", "cartridges gun", "silencer", "grenade", "explosives",
      "bomb making", "air gun", "airgun", "air rifle", "bb gun",
      "taser", "stun gun", "brass knuckles", "machete", "crossbow",
    ],
  },
  {
    name: "regulated",
    message:
      "We don't cover tobacco, vaping, gambling, or alcohol purchases — these are regulated categories we've chosen to stay out of. Try a different shopping question.",
    terms: [
      "cigarette", "cigarettes", "tobacco", "vape", "vapes", "vaping", "e-cigarette", "e cigarette",
      "nicotine pouch", "hookah flavour",
      "betting", "betting app", "betting apps", "online casino", "casino app", "satta",
      "lottery ticket", "gambling", "cash rummy", "real money game",
      "buy alcohol", "alcohol delivery", "buy whisky", "buy whiskey", "buy vodka",
      "buy beer", "buy wine", "buy rum",
    ],
  },
  {
    name: "adult",
    message: "We don't cover adult, illegal, or restricted products and services. Try a different shopping question.",
    terms: [
      // pornography and explicit material
      "porn", "pornography", "pornhub", "xxx", "hentai", "nudes", "nude pics",
      "sex tape", "camgirl", "cam girl", "onlyfans",
      // sexual services and trafficking-adjacent
      "escort", "escorts", "escort service", "call girl", "call girls",
      "prostitute", "prostitution", "brothel", "massage parlour sex", "sexual services",
      "mail order bride", "human trafficking",
      // explicit adult products (sexual-wellness HEALTH products stay allowed)
      "sex toy", "sex toys", "sex doll", "sex dolls", "dildo", "dildos",
      "vibrator sex", "anal beads", "butt plug", "fleshlight", "adult toys",
      "bdsm", "bondage kit", "strap on", "strapon",
      // dating apps and sites
      "dating app", "dating apps", "dating site", "dating sites", "tinder", "matchmaking app",
      // drugs
      "cocaine", "heroin", "meth", "methamphetamine", "mdma", "lsd",
      "buy weed", "buy cannabis", "buy marijuana", "magic mushrooms",
      // counterfeits
      "counterfeit", "fake designer", "replica rolex", "first copy watch",
    ],
  },
];

// Profanity, slurs, and abuse — English and Hinglish. Kept to words whose
// abusive reading is unambiguous at a word boundary. Deliberately absent:
// words with common innocent shopping uses in India — "chakka" (wheel/six),
// "kutta" (pet queries), "saala" (kinship term), and two-letter
// abbreviations (mc/bc) that collide with product codes. The word-boundary
// matcher already protects brand names ("Dickies") and compounds
// ("cocktail", "pussycat") — see containsTerm below.
const PROFANITY = [
  // English
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "bastard",
  "asshole", "dickhead", "cunt", "whore", "slut", "bitch", "bitches",
  "wanker", "twat", "prick", "douchebag",
  "nigger", "nigga", "faggot", "retard", "retarded",
  "rape", "rapist",
  // Hinglish / Hindi
  "randi", "raand", "chutiya", "chutiye", "chodu", "chod",
  "madarchod", "maderchod", "behenchod", "bhenchod", "bahenchod", "benchod",
  "bhosdike", "bhosdi", "bhosadike", "bsdk",
  "gandu", "gaand", "gand", "lund", "lauda", "lawda", "loda",
  "bhadwa", "bhadwe", "harami", "haramzada", "haramkhor",
  "kamina", "kamine", "chinal", "jhaant", "jhant", "tatti",
];

function containsTerm(text, term) {
  // Word-boundary match so "analytics" isn't caught by "anal", "assess" isn't
  // caught by "ass", and "Scunthorpe" survives. This is the classic failure
  // mode of naive substring filters.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(text);
}

/**
 * Returns { blocked: boolean, reason: string|null }
 * reason is a short, non-judgemental message shown to the user.
 */
export function checkQuery(queryText) {
  const q = (queryText || "").toLowerCase().trim();
  if (!q) return { blocked: false, reason: null };

  // Minor-protection co-occurrence rule runs before everything else.
  const mentionsMinor = MINOR_TERMS.some((t) => containsTerm(q, t));
  if (mentionsMinor && SEXUAL_CONTEXT.some((t) => containsTerm(q, t))) {
    return {
      blocked: true,
      reason: "We can't help with that. Try a different shopping question.",
    };
  }

  for (const cat of RESTRICTED_CATEGORIES) {
    for (const term of cat.terms) {
      if (containsTerm(q, term)) return { blocked: true, reason: cat.message };
    }
  }

  for (const word of PROFANITY) {
    if (containsTerm(q, word)) {
      return {
        blocked: true,
        reason: "Let's keep it civil — rephrase your question without abusive language and we'll be happy to help with your shopping research.",
      };
    }
  }

  return { blocked: false, reason: null };
}

// --- Listing-side filter -----------------------------------------------------
// The same restricted categories applied to PRODUCT text, so a restricted
// product that slipped through a bulk feed approval can still never be
// shortlisted or shown as a sponsored match. Products stay untouched in the
// database and admin views — they are simply unmatchable.
const BLOCKED_LISTING_TERMS = RESTRICTED_CATEGORIES.flatMap((c) => c.terms);

export function isBlockedListing(listingText) {
  const t = (listingText || "").toLowerCase();
  if (!t) return false;
  return BLOCKED_LISTING_TERMS.some((term) => containsTerm(t, term));
}
