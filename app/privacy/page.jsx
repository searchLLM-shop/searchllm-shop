import LegalPage from "@/components/LegalPage";
import { PRIVACY_POLICY } from "@/lib/constants";

export const metadata = { title: "Privacy Policy — SearchLLM" };

export default function Page() {
  return <LegalPage title="Privacy Policy" updated="July 2026">{PRIVACY_POLICY}</LegalPage>;
}
