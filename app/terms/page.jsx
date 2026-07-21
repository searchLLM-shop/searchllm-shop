import LegalPage from "@/components/LegalPage";
import { TERMS } from "@/lib/constants";
import { TERMS_DE } from "@/lib/legalDe";
import { resolveLocale } from "@/lib/i18n";
import { headers } from "next/headers";

export const metadata = { title: "Terms of Use — SearchLLM" };

export default async function Page() {
  // Serve the German text to visitors in German-speaking markets. German
  // consumer law expects terms in the language of the transaction, so this
  // isn't only a courtesy.
  const h = await headers();
  const locale = resolveLocale({
    country: h.get("x-vercel-ip-country"),
    acceptLanguage: h.get("accept-language"),
  });
  const isDe = locale === "de";

  return (
    <LegalPage title={isDe ? "Nutzungsbedingungen" : "Terms of Use"} updated={isDe ? "Juli 2026" : "July 2026"}>
      {isDe && (
        <div style={{ background: "#BA75171A", border: "0.5px solid #BA751744", borderRadius: 8, padding: "10px 12px", marginBottom: 18, fontSize: 12, color: "#854F0B" }}>
          Diese deutsche Fassung ist eine Übersetzung der englischen Originalfassung und wurde noch nicht
          rechtlich geprüft. Im Zweifel gilt die englische Fassung.
        </div>
      )}
      {isDe ? TERMS_DE : TERMS}
    </LegalPage>
  );
}
