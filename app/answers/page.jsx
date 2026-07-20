import Link from "next/link";
import { listPublishedAnswers } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "Shopping answers — SearchLLM",
  description: "Honest shopping research: one clear pick per question, with the trade-offs and the alternatives we didn't choose.",
  alternates: { canonical: "https://searchllm.shop/answers" },
};

export default async function AnswersIndex() {
  const answers = await listPublishedAnswers({ limit: 100 }).catch(() => []);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "8px 4px 48px" }}>
      <Link href="/" style={{ fontSize: 12, color: "#0F6E56", textDecoration: "none" }}>← SearchLLM</Link>
      <h1 style={{ fontSize: 26, fontWeight: 600, margin: "18px 0 6px" }}>Shopping answers</h1>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 24px", lineHeight: 1.7 }}>
        Questions we&apos;ve researched. One honest pick each, with what it&apos;s good for, who should skip it,
        and the alternatives we considered.
      </p>

      {answers.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>No published answers yet.</p>
      ) : (
        answers.map((a) => (
          <Link key={a.slug} href={`/answers/${a.slug}`} style={{ display: "block", textDecoration: "none", color: "inherit", padding: "14px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{a.topic || a.headline}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{a.summary}</div>
          </Link>
        ))
      )}
    </main>
  );
}
