/**
 * Which API reads keep an offline copy: the one list both "network-first with an offline copy"
 * adapters follow, the service worker on the web (public/sw.js) and lib/accountData.ts in the
 * Android app, which has no service worker. Part of lib/accountData.ts, kept apart because it has
 * no imports: vite.config.ts reads it too, to write public/sw.js's copy (offlineCopiesScript).
 */

/** Cache Storage holding the copies (and covers); the service worker drops other versions of it. */
export const OFFLINE_CACHE = "readsync-api-v1";

/** Marks an answer taken from the offline copy rather than the server. */
export const OFFLINE_COPY_HEADER = "X-Offline-Copy";

/** A book's own cover never changes: once kept, it is used without asking the server. */
export const KEPT_COVER = /^\/api\/books\/[^/]+\/cover$/;

/**
 * Library data kept for offline use: the last good answer to each of these GETs. `native: false`
 * marks what only the service worker keeps: the Android app has the reader settings in
 * localStorage, asks for positions only to find newer ones, and keeps the session itself (the
 * account last signed in, lib/api.ts).
 */
export const OFFLINE_COPIES: { path: RegExp; native: boolean }[] = [
  { path: /^\/api\/config$/, native: true },
  { path: /^\/api\/me$/, native: true },
  { path: /^\/api\/settings$/, native: false },
  { path: /^\/api\/folders$/, native: true },
  { path: /^\/api\/books$/, native: true },
  { path: /^\/api\/books\/[^/]+$/, native: true },
  { path: /^\/api\/books\/[^/]+\/(about|highlights)$/, native: true },
  { path: /^\/api\/books\/[^/]+\/progress$/, native: false },
  { path: /^\/api\/auth\/get-session$/, native: false },
];

/** Where the build puts the service worker's copy of the list (it loads it with importScripts). */
export const OFFLINE_COPIES_SCRIPT = "offline-copies.js";

/** The service worker's copy: a plain script setting `self.OFFLINE_COPIES`. */
export function offlineCopiesScript() {
  const copies = OFFLINE_COPIES.map((c) => `    { path: ${c.path}, native: ${c.native} },`).join("\n");
  return `// Written by the build from src/lib/offlineCopies.ts: edit that file, not this one.
self.OFFLINE_COPIES = {
  cache: ${JSON.stringify(OFFLINE_CACHE)},
  header: ${JSON.stringify(OFFLINE_COPY_HEADER)},
  cover: ${KEPT_COVER},
  copies: [
${copies}
  ],
};
`;
}
