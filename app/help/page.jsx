// app/help/page.jsx — how to ask, and how to read what you get back.
// The honesty model is the product; this page teaches people to use it.

export const metadata = {
  title: "Help — SearchLLM",
  description: "How to ask great shopping questions, and how to read our honest answers.",
};

export default function HelpPage() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px", lineHeight: 1.8, fontSize: 14, color: "var(--color-text-primary)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>How to use SearchLLM</h1>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 28 }}>
        Ask a real shopping question in your own words, get one honest, reasoned pick. Here&apos;s how to get the most out of it.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Writing a good question</h2>
      <p>The best questions include three things: <strong>the product</strong>, <strong>what matters to you</strong>, and <strong>your budget</strong>. Compare:</p>
      <p style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
        ❌ &quot;face wash&quot;<br />
        ✅ &quot;ubtan face wash under ₹300 for oily skin&quot;
      </p>
      <p>Budgets work the way you&apos;d say them: &quot;under ₹2,000&quot; means a ceiling, &quot;around 1L&quot; means that price class (lakh and k notation both work). Add who or what it&apos;s for — &quot;for a bright living room&quot;, &quot;for a beginner&quot; — and the answer sharpens further. You can also attach a photo of a product to find similar items, and after any answer, tap the <em>Sharpen this pick</em> chips to refine in one tap.</p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Reading the answer</h2>
      <p>Every answer gives you one clear pick with the reasoning, a <strong>Good for / Skip if</strong> pair so you can tell whether the pick fits <em>you</em>, and alternatives we considered but didn&apos;t choose — including why.</p>
      <p><strong>About Amazon links:</strong> when no partner product matches your question, we may show a clearly-labelled Amazon browse link. As an Amazon Associate, we earn from qualifying purchases made through those links — and as always, this never changes the price you pay.</p>
      <p><strong>About the sponsored match:</strong> when a product from our partner stores genuinely answers your question, it appears in a clearly-labelled card with a link. Three honest promises about it: the AI that writes your answer is never told what we earn; a partner product only appears when the AI judges it a genuinely good answer — many searches show none; and the alternatives listed below carry no links at all, which is how you can tell the advice comes first. Clicking a sponsored link never changes the price you pay.</p>
      <p>We don&apos;t sell or ship anything — purchases, delivery and returns are between you and the retailer, so always confirm price and specs on the store&apos;s own page.</p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>What we don&apos;t cover</h2>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Medicines of any kind (that&apos;s for doctors and pharmacists), weapons, tobacco and vaping, gambling, alcohol purchase, and adult products or services. Sexual-wellness health products (condoms, lubricants, intimate hygiene) are ordinary purchases and fully supported. Full list in the <a href="/terms" style={{ color: "#0F6E56" }}>Terms of Use</a>.
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "26px 0 8px" }}>Points and rewards</h2>
      <p>You earn points on every pick and on every confirmed purchase — see <a href="/points" style={{ color: "#0F6E56" }}>How points work</a> for the full picture.</p>

      <p style={{ marginTop: 30 }}>
        <a href="/" style={{ color: "#0F6E56", fontWeight: 500 }}>← Back to research</a>
      </p>
    </main>
  );
}
