const CACHE = "accelerateur-v3";
const OFFLINE_URL = "/offline.html";
const ASSETS = ["/", "/index.html", "/manifest.json", OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  // Laisser passer les requêtes externes (Supabase, Stripe, APIs) et tout ce qui n'est pas GET
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  // Ne jamais mettre en cache les fonctions serveur
  if (req.url.includes("/.netlify/") || req.url.includes("/api/")) return;

  if (req.mode === "navigate") {
    // Pages : réseau d'abord, puis version en cache, puis page hors ligne
    e.respondWith(
      fetch(req).catch(async () =>
        (await caches.match(req)) || (await caches.match(OFFLINE_URL))
      )
    );
    return;
  }
  e.respondWith(
    fetch(req).catch(async () => (await caches.match(req)) || Response.error())
  );
});
