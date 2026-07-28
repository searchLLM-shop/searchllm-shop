// public/sw.js
//
// Deliberately minimal. Its ONLY job is to satisfy Chrome's installability
// requirement (a registered service worker with a fetch handler), which is
// what makes "Install app" appear in the browser menu and enables the
// in-page install button.
//
// It caches NOTHING. A caching service worker on a site whose answers,
// points and gates are all live data would serve stale state and be
// painful to debug — the classic PWA footgun. Pass-through only.
// If a caching strategy is ever wanted, bump SW_VERSION so old workers
// are replaced cleanly.

const SW_VERSION = "1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Pass straight through to the network. Present only for installability.
  event.respondWith(fetch(event.request));
});
