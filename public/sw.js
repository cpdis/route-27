// Route 27 offline shell. Pages: network first, cached copy without signal.
// Hashed build assets: cache first. API calls are never cached here; the page
// keeps its own last-good departures in localStorage.
const VERSION = "route27-v3";
const SHELL = ["/", "/icon.svg", "/apple-touch-icon.png", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/source") return;

  if (request.mode === "navigate") {
    // Weak signal at the stop: after 4 s, show the cached shell and let the
    // page fetch departures itself.
    const network = fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then(cache => cache.put("/", copy));
      }
      return response;
    });
    const cached = () => caches.match("/");
    const slow = new Promise(resolve => setTimeout(resolve, 4000)).then(cached);
    event.respondWith(
      Promise.race([network.catch(cached), slow.then(hit => hit || network)])
        .then(response => response || network)
        .catch(() => cached().then(hit => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});
