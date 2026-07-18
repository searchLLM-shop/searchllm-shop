// lib/contentFilter.js
//
// Blocks queries that fall outside what this service supports, as set out in
// the Terms of Use: adult/sexual products and services, obscenity, profanity,
// illegal drugs, and weapons.
//
// DESIGN NOTE — deliberately narrow, not maximal.
// A crude blocklist does real damage on a shopping site. Legitimate shoppers
// search for condoms, menstrual cups, breast pumps, lubricants for medical
// dryness, and intimate hygiene products — these are ordinary health and
// personal-care purchases, and one of our own affiliate merchants (Sirona)
// sells exactly this category. Blocking them would be both commercially
// self-defeating and quietly insulting to the person asking.
//
// So this filter targets pornography, sexual services, explicit adult
// products, slurs and abuse — not human bodies or health needs. Where a term
// is genuinely ambiguous, we allow it: a wrongly blocked shopper is a worse
// outcome than a borderline query reaching a model that will itself decline
// anything inappropriate.

// Explicit adult products and services. Word-boundary matched.
const BLOCKED_TERMS = [
  // pornography and explicit material
  "porn", "pornography", "pornhub", "xxx", "hentai", "nudes", "nude pics",
  "sex tape", "camgirl", "cam girl", "onlyfans",
  // sexual services
  "escort", "escorts", "escort service", "call girl", "call girls",
  "prostitute", "prostitution", "brothel", "massage parlour sex", "sexual services",
  // explicit adult products
  "sex toy", "sex toys", "sex doll", "sex dolls", "dildo", "dildos",
  "vibrator sex", "anal beads", "butt plug", "fleshlight", "adult toys",
  "bdsm", "bondage kit", "strap on", "strapon",
  // drugs
  "cocaine", "heroin", "meth", "methamphetamine", "mdma", "lsd",
  "buy weed", "buy cannabis", "buy marijuana", "magic mushrooms",
  // weapons
  "handgun", "pistol for sale", "buy gun", "buy rifle", "ammunition",
  "silencer", "grenade", "explosives", "bomb making",
  // counterfeits
  "counterfeit", "fake designer", "replica rolex", "first copy watch",
];

// Profanity and slurs. Kept to unambiguous cases used as abuse.
const PROFANITY = [
  "fuck", "fucking", "motherfucker", "shit", "bullshit", "bastard",
  "asshole", "dickhead", "cunt", "whore", "slut", "bitch",
  "randi", "chutiya", "madarchod", "behenchod", "bhenchod", "gandu", "lauda",
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

  for (const term of BLOCKED_TERMS) {
    if (containsTerm(q, term)) {
      return {
        blocked: true,
        reason:
          "We don't cover adult, illegal, or restricted products. Try a different shopping question.",
      };
    }
  }

  for (const word of PROFANITY) {
    if (containsTerm(q, word)) {
      return {
        blocked: true,
        reason: "Please rephrase your question without profanity.",
      };
    }
  }

  return { blocked: false, reason: null };
}
