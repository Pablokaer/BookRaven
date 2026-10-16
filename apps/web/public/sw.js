/*
 * BookRaven service worker: the app opens and shows your library without a connection.
 * - the app shell and its hashed assets are cached as they load; on a slow connection the
 *   cached shell opens the app after a few seconds while the network copy is still fetched;
 * - library data (books list, collections, settings, highlights, book pages, session) is
 *   network-first with the last good copy as the offline fallback; covers never change for a
 *   book, so a cached cover is used without asking the server;
 * - book files are not handled here: the app keeps the books you open in its own cache.
 */
const APP = "readsync-app-v1";
const API = "readsync-api-v1";
/** The shell of the version before the cached one, kept so its pages' files are not pruned. */
const PREVIOUS_SHELL = "/?shell=previous";
/** How long a navigation waits for the network before opening the cached shell. */
const SHELL_TIMEOUT = 4000;

const API_CACHED = [
  /^\/api\/config$/,
  /^\/api\/me$/,
  /^\/api\/settings$/,
  /^\/api\/folders$/,
  /^\/api\/books$/,
  /^\/api\/books\/[^/]+$/,
  /^\/api\/books\/[^/]+\/(about|highlights|progress)$/,
  /^\/api\/auth\/get-session$/,
];
const COVER = /^\/api\/books\/[^/]+\/cover$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("readsync-app-") && key !== APP) await caches.delete(key);
        if (key.startsWith("readsync-api-") && key !== API) await caches.delete(key);
      }
      await self.clients.claim();
      await pruneAssets().catch(() => {});
    })(),
  );
});

/** The network's answer at once; a good one is also kept (in the background) for offline use. */
async function networkFirst(event, cacheName) {
  const request = event.request;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then((cache) => cache.put(request, copy)));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { cacheName });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(event, cacheName) {
  const request = event.request;
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(cacheName).then((cache) => cache.put(request, copy)));
  }
  return response;
}

/** Keeps a new shell, and the one it replaces when that was another version. */
async function saveShell(response) {
  const cache = await caches.open(APP);
  const current = await cache.match("/");
  if (current) {
    const [before, after] = await Promise.all([current.clone().text(), response.clone().text()]);
    if (before !== after) await cache.put(PREVIOUS_SHELL, current);
  }
  await cache.put("/", response);
}

/**
 * Every route is the same single-page app: the network's copy, or the cached one when the network
 * fails or takes longer than SHELL_TIMEOUT (the network's copy is still saved when it arrives).
 */
async function openShell(network) {
  const cached = caches.match("/", { cacheName: APP });
  try {
    const first = await Promise.race([network, new Promise((resolve) => setTimeout(resolve, SHELL_TIMEOUT, null))]);
    if (first) return first;
    return (await cached) ?? (await network);
  } catch (err) {
    const shell = await cached;
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Android app downloads (APK, update bundles) always come from the server.
  if (url.pathname.startsWith("/downloads/")) return;

  if (request.mode === "navigate") {
    const network = fetch(request);
    // Registered before the page reads the response, so the copy is taken first.
    event.waitUntil(network.then((response) => response.ok && saveShell(response.clone())).catch(() => {}));
    event.respondWith(openShell(network));
  } else if (url.pathname.startsWith("/assets/") || /\.(woff2?|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(event, APP));
  } else if (COVER.test(url.pathname)) {
    event.respondWith(cacheFirst(event, API));
  } else if (API_CACHED.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(event, API));
  }
});

// Signing out drops the cached library data.
self.addEventListener("message", (event) => {
  if (event.data === "signed-out") event.waitUntil(caches.delete(API));
});

// ---------- Pruning files of old versions ----------

/** Files whose text can name other files (the rest are images, fonts…). */
const TEXT_FILE = /\.(m?js|css|json|html)$/;

/**
 * Which of the cached asset files (`names`, e.g. "index-B1x2y3z4.js") no version of the app in
 * `roots` (the texts of its index.html) can load. A file is kept when its name appears in the
 * shell or in a kept file's text (Vite's chunks import each other as "./name-HASH.js"), so what
 * the pages and readers load later is kept too. `readText(name)` reads a cached file's text.
 */
async function unreachableAssets(roots, names, readText) {
  const words = new Set();
  const addWords = (text) => {
    for (const word of text.split(/[^\w.$~-]+/)) {
      const w = word.replace(/^\.+|\.+$/g, "");
      if (w) words.add(w);
    }
  };
  roots.forEach(addWords);
  const kept = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of names) {
      if (kept.has(name) || !words.has(name)) continue;
      kept.add(name);
      grew = true;
      if (TEXT_FILE.test(name)) addWords(await readText(name));
    }
  }
  return names.filter((name) => !kept.has(name));
}

/**
 * Deletes cached /assets/ files that neither the server's current shell nor the cached ones
 * (this version and the previous) lead to. Anything going wrong deletes nothing.
 */
async function pruneAssets() {
  const cache = await caches.open(APP);
  const roots = [];
  try {
    const fresh = await fetch("/", { cache: "no-store" });
    if (fresh.ok) roots.push(await fresh.text());
  } catch {
    /* offline: the cached shells are enough */
  }
  for (const key of ["/", PREVIOUS_SHELL]) {
    const shell = await cache.match(key);
    if (shell) roots.push(await shell.text());
  }
  if (!roots.length) return;

  const byName = new Map();
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/assets/")) continue;
    const name = path.slice(path.lastIndexOf("/") + 1);
    byName.set(name, [...(byName.get(name) ?? []), request]);
  }
  const readText = async (name) => {
    const response = await cache.match(byName.get(name)[0]);
    if (!response) throw new Error(`missing ${name}`);
    return response.text();
  };
  const unused = await unreachableAssets(roots, [...byName.keys()], readText);
  for (const name of unused) for (const request of byName.get(name)) await cache.delete(request);
}
