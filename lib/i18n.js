// lib/i18n.js
//
// Shopper-facing translations. Deliberately scoped: the research and saved
// sections are what a German visitor sees, so those are translated. The admin
// queue and reports stay in English — they're operator tools, and translating
// them would be work with no reader.
//
// The AI's answers are handled separately: the model is told which language to
// write in, so recommendations come back in German natively rather than being
// translated after the fact, which reads badly for anything conversational.

import { ENABLE_GERMAN } from "@/lib/constants";

export const LOCALES = {
  en: { code: "en", name: "English", htmlLang: "en" },
  de: { code: "de", name: "Deutsch", htmlLang: "de" },
};

export const DEFAULT_LOCALE = "en";

// Countries where German is the working language.
const GERMAN_COUNTRIES = new Set(["DE", "AT", "CH", "LI"]);

/**
 * Resolves which language to show, in order of how strongly each signal
 * expresses the person's actual preference.
 */
export function resolveLocale({ stored, urlParam, country, acceptLanguage } = {}) {
  // German is paused until its legal work is validated (see ENABLE_GERMAN in
  // constants.js). Every signal — including a previously stored "de" choice
  // or a shared ?lang=de link — resolves to English while the flag is off.
  if (!ENABLE_GERMAN) return DEFAULT_LOCALE;
  // 1. An explicit choice always wins and is never overridden.
  if (stored && LOCALES[stored]) return stored;
  // 2. A link someone shared with ?lang=de
  if (urlParam && LOCALES[urlParam]) return urlParam;
  // 3. Where they are — a shopper in Germany is served German products.
  if (country && GERMAN_COUNTRIES.has(String(country).toUpperCase())) return "de";
  // 4. Their browser's stated preference.
  if (acceptLanguage && /(^|,)\s*de\b/i.test(acceptLanguage)) return "de";
  return DEFAULT_LOCALE;
}

const STRINGS = {
  en: {
    // Consent gate
    tagline1: "We tell you what to buy.",
    tagline2: "We get paid only if you do.",
    tagline3: "We tell you that, every time.",
    subtitle: "One honest pick, the alternatives we didn't choose, and why — for every shopping question.",
    beforeStart: "Before you start, please read how recommendations work here.",
    privacyLink: "Privacy Policy (read first)",
    termsLink: "Terms of Use, including our honesty commitment (read first)",
    acceptPrivacy: "I accept the Privacy Policy",
    acceptTerms: "I accept the Terms of Use",
    startResearching: "Start researching",

    // Tabs
    tabResearch: "Research",
    tabSaved: "Saved",

    // Research
    askPrompt: "Ask a real shopping question. Get one honest pick, with the trade-offs and the alternatives we didn't choose.",
    placeholder: "e.g. best rain jacket for a 3-day hike under €200",
    getMyPick: "Get my pick",
    attach: "Attach photo",
    reading: "Reading…",
    thinking: "Thinking…",
    forQuery: "For:",

    // Result
    ourPick: "Our pick",
    confidence: "confidence",
    goodFor: "Good for:",
    skipIf: "Skip if:",
    alsoConsidered: "We also considered (no affiliate relationship)",
    sponsoredVia: "Sponsored · affiliate link via",
    viewAndBuy: "View and buy →",
    viewOn: "View on",
    disclosure: "This never changes the price you pay, and it's never the reason this option was suggested — see alternatives below.",
    aiCaveat: "AI can make mistakes. Check the price, availability and specifications on the retailer's own page before buying. We don't sell or ship anything — purchases, delivery and returns are between you and the retailer.",
    fromPhoto: "From your photo, I can see:",

    // Actions
    savePick: "Save this pick",
    saved: "✓ Saved",
    newQuestion: "New question",
    remove: "Remove",
    view: "View",
    hide: "Hide",

    // Saved
    savedPicks: "Saved picks",
    noSaved: "Nothing saved yet. Save a pick and it'll be here when you come back.",
    savedCount: "saved",
    savedOf: "of",
    alreadySaved: "Already saved — find it in the Saved tab.",
    savedOk: "Saved.",

    // Account
    guest: "Guest",
    free: "Free",
    plus: "Plus",
    picksLeft: "picks left",
    signIn: "Sign in",
    signOut: "Sign out",
    unlimited: "Unlimited",

    // Errors
    limitReached: "That's your picks for today. The count resets at midnight UTC — come back tomorrow and we'll pick up where you left off. Your saved picks stay available in the meantime.",
    researchFailed: "Couldn't complete the research — try rephrasing the question.",
    honestFooter: "Honest recommendations, always disclosed",
  },

  de: {
    // Consent gate
    tagline1: "Wir sagen dir, was du kaufen sollst.",
    tagline2: "Wir verdienen nur, wenn du es tust.",
    tagline3: "Und wir sagen dir das — jedes Mal.",
    subtitle: "Eine ehrliche Empfehlung, die Alternativen, die wir nicht gewählt haben, und warum — für jede Kauffrage.",
    beforeStart: "Bevor du startest, lies bitte, wie unsere Empfehlungen zustande kommen.",
    privacyLink: "Datenschutzerklärung (bitte zuerst lesen)",
    termsLink: "Nutzungsbedingungen, einschließlich unseres Ehrlichkeitsversprechens (bitte zuerst lesen)",
    acceptPrivacy: "Ich akzeptiere die Datenschutzerklärung",
    acceptTerms: "Ich akzeptiere die Nutzungsbedingungen",
    startResearching: "Recherche starten",

    // Tabs
    tabResearch: "Recherche",
    tabSaved: "Gespeichert",

    // Research
    askPrompt: "Stell eine echte Kauffrage. Du bekommst eine ehrliche Empfehlung — mit den Kompromissen und den Alternativen, die wir nicht gewählt haben.",
    placeholder: "z. B. beste Regenjacke für eine 3-Tages-Wanderung unter 200 €",
    getMyPick: "Empfehlung holen",
    attach: "Foto anhängen",
    reading: "Wird gelesen…",
    thinking: "Denkt nach…",
    forQuery: "Zu:",

    // Result
    ourPick: "Unsere Empfehlung",
    confidence: "Sicherheit",
    goodFor: "Gut für:",
    skipIf: "Finger weg, wenn:",
    alsoConsidered: "Ebenfalls geprüft (keine Provisionsbeziehung)",
    sponsoredVia: "Gesponsert · Affiliate-Link über",
    viewAndBuy: "Ansehen und kaufen →",
    viewOn: "Ansehen bei",
    disclosure: "Das ändert nie den Preis, den du zahlst — und es ist nie der Grund, warum wir dieses Produkt vorschlagen. Siehe die Alternativen unten.",
    aiCaveat: "KI kann Fehler machen. Prüfe Preis, Verfügbarkeit und Details auf der Seite des Händlers, bevor du kaufst. Wir verkaufen und versenden nichts — Kauf, Lieferung und Rückgabe laufen direkt über den Händler.",
    fromPhoto: "Auf deinem Foto erkenne ich:",

    // Actions
    savePick: "Empfehlung speichern",
    saved: "✓ Gespeichert",
    newQuestion: "Neue Frage",
    remove: "Entfernen",
    view: "Ansehen",
    hide: "Ausblenden",

    // Saved
    savedPicks: "Gespeicherte Empfehlungen",
    noSaved: "Noch nichts gespeichert. Speichere eine Empfehlung — sie ist dann hier, wenn du wiederkommst.",
    savedCount: "gespeichert",
    savedOf: "von",
    alreadySaved: "Bereits gespeichert — du findest sie im Tab „Gespeichert“.",
    savedOk: "Gespeichert.",

    // Account
    guest: "Gast",
    free: "Kostenlos",
    plus: "Plus",
    picksLeft: "Empfehlungen übrig",
    signIn: "Anmelden",
    signOut: "Abmelden",
    unlimited: "Unbegrenzt",

    // Errors
    limitReached: "Das waren deine Empfehlungen für heute. Der Zähler wird um Mitternacht (UTC) zurückgesetzt — komm morgen wieder, dann machen wir da weiter, wo du aufgehört hast. Deine gespeicherten Empfehlungen bleiben in der Zwischenzeit verfügbar.",
    researchFailed: "Die Recherche konnte nicht abgeschlossen werden — formuliere die Frage bitte anders.",
    honestFooter: "Ehrliche Empfehlungen, immer offengelegt",
  },
};

/** Returns a lookup function for the given locale, falling back to English. */
export function t(locale) {
  const table = STRINGS[locale] || STRINGS[DEFAULT_LOCALE];
  return (key) => table[key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
}

/** Language name the model should write its answer in. */
export function languageForModel(locale) {
  return locale === "de" ? "German" : "English";
}
