export async function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /go/

Sitemap: https://searchllm.shop/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
