import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata = {
  title: "SearchLLM — shopping research, honestly",
  description: "One honest pick, the alternatives we didn't choose, and why — for every shopping question.",
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
          {/* Impact.com site-ownership verification. Impact's tag uses a
              non-standard `value` attribute (not `content`), so it can't go
              through Next's metadata API — instead we render the exact tag
              here and React 19 hoists <meta> elements into <head>
              automatically. Renders nothing until the env var is set. */}
          {impactVerification && (
            <meta name="impact-site-verification" value={impactVerification} />
          )}
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
