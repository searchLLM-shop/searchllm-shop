/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Baseline security headers (added 2026-08-25 security review) — none of
  // these were set anywhere (no next.config.js headers, no vercel.json
  // headers), so the site was relying entirely on whatever Vercel's edge
  // adds by default. A full Content-Security-Policy is deliberately NOT
  // included here: this app loads Clerk, Razorpay Checkout, Google Fonts,
  // and Google Tag Manager, and a guessed CSP risks silently breaking
  // sign-in or checkout in production rather than failing loudly in dev —
  // that needs its own careful pass with each origin verified, not a
  // drive-by addition. What's below is unambiguous, low-risk hardening.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Clickjacking: nothing in this app is meant to be framed by
          // another site, and the redeem/upgrade buttons are exactly the
          // kind of action a clickjacking overlay would target.
          { key: "X-Frame-Options", value: "DENY" },
          // Stops the browser guessing content-types away from what the
          // server declared — closes a class of MIME-sniffing XSS.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the full referrer only to our own origin; cross-origin
          // requests (affiliate/outbound links included) get origin-only,
          // never the full path/query that might carry a query string.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Deny browser features this app never uses, defense-in-depth
          // against a compromised/malicious third-party script trying to
          // access the camera, mic, or location.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
