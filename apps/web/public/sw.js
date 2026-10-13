/*
 * Mico-livrão service worker: the app opens and shows your library without a connection.
 * - the app shell and its hashed assets are cached as they load;
 * - library data (books list, collections, settings, highlights, covers, session) is
 *   network-first with the last good copy as the offline fallback;
 * - book files are not handled here: the app keeps the books you open in its own cache.
 */
const APP = "readsync-app-v1";
const API = "readsync-api-v1";

const API_CACHED = [
  /^\/api\/config$/,
  /^\/api\/me$/,
  /^\/api\/settings$/,
  /^\/api\/folders$/,
  /^\/api\/books$/,
  /^\/api\/books\/[^/]+$/,
  /^\/api\/books\/[^/]+\/(cover|highlights|progress)$/,
  /^\/api\/auth\/get-session$/,
];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("readsync-app-") && key !== APP) await caches.delete(key);
        if (key.startsWith("readsync-api-") && key !== API) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheName, cacheKey = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(APP);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Every route is the same single-page app.
    event.respondWith(networkFirst(request, APP, "/"));
  } else if (url.pathname.startsWith("/assets/") || /\.(woff2?|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (API_CACHED.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(request, API));
  }
});

// Signing out drops the cached library data.
self.addEventListener("message", (event) => {
  if (event.data === "signed-out") event.waitUntil(caches.delete(API));
});
