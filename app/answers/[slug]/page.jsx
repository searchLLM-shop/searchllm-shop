// Public, indexable answer page.
//
// This is the growth engine: every researched question becomes a page that can
// rank organically. Unlike paid acquisition — where a click costs tens of
// rupees and an affiliate commission returns single digits — organic traffic
// costs nothing per visitor and compounds.
//
// Pages are server-rendered so crawlers see full content, and carry JSON-LD
// so search engines can read the question-and-answer structure directly.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedAnswer, incrementAnswerViews } from "@/lib/db";

export const revalidate = 3600; // rebuild hourly at most

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = await getPublishedAnswer(slug).catch(() => null);
  if (!a) return { title: "Answer not found — SearchLLM" };

  const title = `${a.topic || a.headline} — SearchLLM`;
  const description = (a.summary || a.headline || "").slice(0, 155);
  return {
    title,
    description,
    alternates: { canonical: `https://searchllm.shop/answers/${slug}` },
    // Explicit rather than implicit: a page earns indexing by passing the
    // publication gate, and a withdrawn page must drop out of the index
    // while keeping its URL alive.
    robots: a.status === "withdrawn"
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: { title, description, type: "article", url: `https://searchllm.shop/answers/${slug}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function AnswerPage({ params }) {
  const { slug } = await params;
  const a = await getPublishedAnswer(slug).catch(() => null);
  if (!a) notFound();

  incrementAnswerViews(slug).catch(() => {});

  const alternatives = Array.isArray(a.alternatives) ? a.alternatives : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [{
      "@type": "Question",
      name: a.topic || a.headline,
      acceptedAnswer: { "@type": "Answer", text: [a.headline, a.body].filter(Boolean).join(" ") },
    }],
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "8px 4px 48px" }}>
      {/* JSON.stringify does NOT escape "</script>" — and this content derives
          from model output influenced by user queries, on a public page. The
          \u003c replacement is the standard, complete fix for script-context
          JSON injection. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <Link href="/" style={{ fontSize: 12, color: "#0F6E56", textDecoration: "none" }}>← SearchLLM</Link>

      <h1 style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3, margin: "18px 0 6px" }}>
        {a.topic || a.headline}
      </h1>
      {a.published_at && (
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "0 0 22px" }}>
          Researched {new Date(a.published_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
        </p>
      )}

      <div style={{ background: "var(--color-background-secondary)", border: "1.5px solid #0F6E5644", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 500, color: "#0F6E56", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>Our pick</div>
        <h2 style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.4, margin: "0 0 12px" }}>{a.headline}</h2>
        {a.body && <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--color-text-secondary)", margin: "0 0 14px" }}>{a.body}</p>}
        {a.who_for && <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 5px" }}><strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Good for:</strong> {a.who_for}</p>}
        {a.who_skip && <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}><strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Skip if:</strong> {a.who_skip}</p>}
      </div>

      {a.networkLink && (
        <div style={{ background: "#BA75171A", border: "1px solid #BA751744", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: "#854F0B", letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", background: "#BA751733", borderRadius: 20, display: "inline-block", marginBottom: 10 }}>
            Sponsored · affiliate link via {a.network}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {a.imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={a.imageUrl} alt={a.product} width={84} height={84} style={{ objectFit: "contain", background: "#fff", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)" }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{a.product}</span>
                <span style={{ fontSize: 13, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{a.price ? `~${a.price} est.` : ""}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>{a.brand}</div>
              <a href={`/out/${a.listing_id}?ctx=answer`} target="_blank" rel="noopener noreferrer sponsored nofollow"
                 style={{ display: "inline-block", fontSize: 13, fontWeight: 500, color: "#fff", background: "#854F0B", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
                {a.merchantDomain ? `View on ${a.merchantDomain} →` : "View and buy →"}
              </a>
            </div>
          </div>
          <p style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 10, marginBottom: 0 }}>
            This never changes the price you pay, and it&apos;s never the reason this option was suggested.
          </p>
        </div>
      )}

      {alternatives.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 8 }}>
            We also considered — chosen by the AI with no knowledge of what we earn. These links go to Amazon and may earn us a commission; your price never changes. Any prices shown are rough estimates, not live.
          </div>
          {alternatives.map((alt, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
              <div>
                <a href={`/alt?p=${encodeURIComponent(alt.name || "")}&ctx=answer`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", textDecoration: "underline", textDecorationColor: "var(--color-border-secondary)", textUnderlineOffset: 3 }}>{alt.name} ↗</a>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{alt.note}</div>
              </div>
              <div style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--color-text-tertiary)" }}>{alt.price ? `~${alt.price} est.` : ""}</div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.6, marginBottom: 24 }}>
        This answer was generated by AI and reviewed before publishing. AI can make mistakes — check price,
        availability and specifications on the retailer&apos;s own page before buying. We don&apos;t sell or ship
        anything; purchases, delivery and returns are between you and the retailer.
      </p>

      <div style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "18px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Have a different shopping question?</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          Ask it and get one honest pick, with the trade-offs and the alternatives we didn&apos;t choose.
        </div>
        <Link href="/" style={{ display: "inline-block", background: "#0F6E56", color: "#fff", padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
          Ask SearchLLM →
        </Link>
      </div>

      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 26, textAlign: "center" }}>
        <Link href="/answers" style={{ color: "inherit" }}>All answers</Link> ·{" "}
        <Link href="/privacy" style={{ color: "inherit" }}>Privacy</Link> ·{" "}
        <Link href="/terms" style={{ color: "inherit" }}>Terms</Link>
      </p>
    </main>
  );
}
