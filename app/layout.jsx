import { ClerkProvider } from "@clerk/nextjs";
import Script from "next/script";
import "./globals.css";

export const metadata = {
  title: "SearchLLM — shopping research, honestly",
  description: "An AI shopping answer engine. One researched answer for every shopping question — never limited to the brands that pay us. We get paid only if you shop.",
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

// Meta Pixel ID for the Facebook/Instagram campaign (2026-11-20). The ID is
// public by design (it appears in every page's source). Disclosed in the
// Privacy Policy's section on tag tooling: it only tells Meta that an ad click
// led to a visit, and no query text or identifiers are ever sent from our code.
const META_PIXEL_ID = "2473902933018957";

export default function RootLayout({ children }) {
  const impactVerification = process.env.NEXT_PUBLIC_IMPACT_SITE_VERIFICATION;
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {/* Meta Pixel Code — beforeInteractive places it in <head>, as Meta's
              install instructions ask. The snippet itself only queues events and
              loads fbevents.js asynchronously, so it does not block rendering. */}
          <Script id="meta-pixel" strategy="beforeInteractive">
            {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`}
          </Script>
        </head>
        {/* Padding is now responsive via clamp() instead of a flat 24px,
            which alone ate ~13% of a 375px-wide phone screen before any
            content started. clamp(12px, 4vw, 24px) gives small phones
            12px, scales up smoothly, and caps at the original 24px on
            larger screens. */}
        <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", padding: "clamp(12px, 4vw, 24px)", boxSizing: "border-box" }}>
        {/* Meta Pixel (noscript) — counts the visit for browsers with scripts off */}
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
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
