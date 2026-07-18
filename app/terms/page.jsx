import LegalPage from "@/components/LegalPage";
import { TERMS } from "@/lib/constants";

export const metadata = { title: "Terms of Use — SearchLLM" };

export default function Page() {
  return <LegalPage title="Terms of Use" updated="July 2026">{TERMS}</LegalPage>;
}
