"use client";

// The "Add to home screen" affordance. Without this, installing is buried
// in a browser menu nobody opens — which is why it went unnoticed.
//
// Three states:
//   - Chrome/Android/desktop: the browser fires beforeinstallprompt, we
//     capture it and show a button that triggers the real install dialog.
//   - iOS Safari: no programmatic install exists, so we show the same
//     button and explain the Share → Add to Home Screen steps.
//   - Already installed (standalone display mode): render nothing.
//
// It also registers the service worker, which is what makes Chrome
// consider the site installable in the first place.

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/track";

// Server-side event, for the Reports tab. Fire-and-forget, and throttled
// by caller where needed — this is measurement, never a blocker.
function recordPwa(eventType) {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType }),
      keepalive: true,
    }).catch(() => {});
    trackEvent(eventType, {});
  } catch {}
}

export default function InstallApp() {
  const [deferred, setDeferred] = useState(null);
  const [isIos, setIsIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed? Nothing to offer.
    const inStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    setStandalone(inStandalone);

    // A session from the installed app. Throttled to once per browser per
    // day so an installed user browsing all afternoon costs one database
    // write, not one per page load — operations are metered.
    if (inStandalone) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        if (window.localStorage.getItem("sllm_pwa_day") !== today) {
          window.localStorage.setItem("sllm_pwa_day", today);
          recordPwa("pwa_standalone_visit");
        }
      } catch {
        recordPwa("pwa_standalone_visit");
      }
    }

    const ua = window.navigator.userAgent || "";
    setIsIos(/iPad|iPhone|iPod/.test(ua) && !window.MSStream);

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => {
      setDeferred(null);
      recordPwa("pwa_installed");
    });

    // Registering the worker is what unlocks installability in Chrome.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) return null;
  if (!deferred && !isIos) return null; // browser hasn't judged it installable yet

  const buttonStyle = {
    background: "none",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: 12,
    padding: "3px 11px",
    fontSize: 12,
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <>
      <button
        className="sllm-install-btn"
        title="Add SearchLLM to your home screen"
        onClick={async () => {
          if (deferred) {
            deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice?.outcome === "dismissed") recordPwa("pwa_prompt_dismissed");
            setDeferred(null);
            return;
          }
          setShowIosHelp((v) => !v);
        }}
        style={buttonStyle}
      >
        ⤓ Add to home screen
      </button>

      {showIosHelp && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 16,
            zIndex: 50,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 12,
            padding: "14px 16px",
            fontSize: 13,
            lineHeight: 1.7,
            color: "var(--color-text-secondary)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
          }}
        >
          <strong style={{ color: "var(--color-text-primary)" }}>Add SearchLLM to your home screen</strong>
          <div style={{ marginTop: 6 }}>
            Tap the <strong>Share</strong> button at the bottom of Safari, scroll down, and choose{" "}
            <strong>Add to Home Screen</strong>. It opens like an app, no install needed.
          </div>
          <button
            onClick={() => setShowIosHelp(false)}
            style={{ marginTop: 10, background: "#0F6E56", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}
          >
            Got it
          </button>
        </div>
      )}
    </>
  );
}
