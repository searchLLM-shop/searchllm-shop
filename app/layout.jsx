import { ClerkProvider } from "@clerk/nextjs";
import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "SearchLLM — shopping research, honestly",
  description: "One honest pick, the alternatives we didn't choose, and why — for every shopping question.",
  // The manifest makes the site installable ("Add to Home Screen") — the
  // free 80% of "we need a mobile app": standalone window, home-screen
  // icon, brand splash. A native app can come later; this ships today.
  manifest: "/manifest.json",
  // iOS ignores most of the web manifest — these are what give an
  // "Add to Home Screen" install a proper icon and standalone chrome.
  appleWebApp: {
    capable: true,
    title: "SearchLLM",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Without this, mobile browsers render the page at a default desktop-width
// viewport (~980px) and zoom out to fit — meaning the layout never actually
// receives a narrow viewport to respond to. This is the single most common
// reason a "responsive" page looks fine in desktop dev tools but broken on
// a real phone. This is the Next.js App Router way of setting it (a literal
// <meta> tag in the JSX would be stripped/ignored by Next's head management).
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F6E56",
};

export default function RootLayout({ children }) {
  const impactVerification = process.env.NEXT_PUBLIC_IMPACT_SITE_VERIFICATION;
  return (
    <ClerkProvider>
      <html lang="en">
        {/* Padding is now responsive via clamp() instead of a flat 24px,
            which alone ate ~13% of a 375px-wide phone screen before any
            content started. clamp(12px, 4vw, 24px) gives small phones
            12px, scales up smoothly, and caps at the original 24px on
            larger screens. */}
        <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", padding: "clamp(12px, 4vw, 24px)", boxSizing: "border-box" }}>
        {/* Google Tag Manager (noscript) — required fallback per Google */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-W8ZBMQHQ"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
          {/* Impact.com site-ownership verification. Impact's tag uses a
              non-standard `value` attribute (not `content`), so it can't go
              through Next's metadata API — instead we render the exact tag
              here and React 19 hoists <meta> elements into <head>
              automatically. Renders nothing until the env var is set. */}
          {impactVerification && (
            <meta name="impact-site-verification" value={impactVerification} />
          )}
          {children}
                {/* Google Tag Manager. The container is empty until tags are added in
            the GTM dashboard — WHAT gets loaded there decides our privacy
            posture: Meta Pixel for campaign attribution is disclosed in the
            Privacy Policy; cross-site advertising/remarketing tags would
            contradict it. Keep the container consistent with the promise. */}
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-W8ZBMQHQ');`}
        </Script>
      </body>
      </html>
    </ClerkProvider>
  );
}
