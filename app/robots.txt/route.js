export async function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /go/
Disallow: /out/

Sitemap: https://searchllm.shop/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
