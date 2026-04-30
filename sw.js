// Kill-switch service worker.
//
// The previous SW used "cache-first" for static assets, which caused stale
// JS/CSS to be served after deployments even when files changed on disk.
//
// This replacement does three things and nothing else:
//   1. Installs immediately (skipWaiting).
//   2. On activate, deletes every cache entry the old SW created.
//   3. Unregisters itself so no SW is active going forward.
//
// Browsers that already have the old SW installed will fetch this file
// (SW updates are always network-first), run this, wipe the caches, and
// remove the registration. Fresh page loads after that will hit the network
// for every asset, and normal HTTP cache headers take over from there.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
  self.clients.claim();
});
