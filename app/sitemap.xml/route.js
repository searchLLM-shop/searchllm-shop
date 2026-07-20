// Sitemap so search engines discover every published answer rather than
// waiting to find them by crawling.
import { getAllPublishedSlugs } from "@/lib/db";

export const revalidate = 3600;

export async function GET() {
  const base = "https://searchllm.shop";
  let answers = [];
  try { answers = await getAllPublishedSlugs(); } catch { /* serve static pages regardless */ }

  const staticPages = ["", "/answers", "/pricing", "/privacy", "/terms", "/refunds", "/contact"];

  const urls = [
    ...staticPages.map((p) => `  <url><loc>${base}${p}</loc><changefreq>weekly</changefreq></url>`),
    ...answers.map((a) => {
      const lastmod = a.published_at ? `<lastmod>${new Date(a.published_at).toISOString().split("T")[0]}</lastmod>` : "";
      return `  <url><loc>${base}/answers/${a.slug}</loc>${lastmod}<changefreq>monthly</changefreq></url>`;
    }),
  ].join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
    { headers: { "Content-Type": "application/xml" } }
  );
}
