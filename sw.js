const CACHE_NAME = "nearify-v1";

const PRECACHE = [
  "/",
  "/index.html",
  "/join/index.html",
  "/events/index.html",
  "/events/event.html",
  "/assets/css/styles.css",
  "/assets/js/analytics.js",
  "/assets/js/config.js",
  "/assets/js/supabaseClient.js",
  "/assets/js/appState.js",
  "/assets/js/join.js",
  "/assets/js/ghostSession.js",
  "/assets/js/ghostConnection.js",
  "/assets/js/navAuth.js",
  "/assets/js/personalConnect.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Supabase API calls — always go to the network
  if (url.hostname.endsWith("supabase.co") || url.hostname === "esm.sh") return;

  // For navigation requests (HTML pages), try network first then fall back to cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // For static assets, cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
