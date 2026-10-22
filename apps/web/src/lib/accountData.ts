import type { Book, Folder, Me } from "./api";
import { KEPT_COVER, OFFLINE_CACHE, OFFLINE_COPIES, OFFLINE_COPY_HEADER } from "./offlineCopies";
import { isNative } from "./platform";
import { readJson, removeKeysWithPrefix, writeJson } from "./storage";

/**
 * The account's data on this device: everything kept here for the signed-in account, so it can
 * be sent (changes made offline) and forgotten (signing out) as one.
 *  - Stores holding the account's data register themselves with `keptForAccount`; signing out
 *    forgets every one, so the next account on a shared device never sees or sends them.
 *  - Library snapshots (books, account, collections) paint the first frame of a cold start.
 *  - Offline copies of library reads: network-first with the last good answer as the fallback.
 *    The service worker does it on the web; the Android app has none, so `withOfflineCopy` does
 *    it there. Both follow one list (lib/offlineCopies.ts).
 */

// ---------- Stores of the account ----------

export type AccountStore = {
  /** Sends the changes waiting for the server; resolves once answered. */
  flush?: () => unknown;
  /** Removes everything the store keeps for the account. */
  forget: () => unknown;
};

const stores = new Set<AccountStore>();

/** Registers a store of the account's data: flushed with the others, and forgotten on sign-out. */
export function keptForAccount(store: AccountStore) {
  stores.add(store);
}

/**
 * Every module that registers a store. Some load only with the pages or the reader (bookmarks,
 * handwriting): they are loaded before flushing or forgetting, so their stores register (and
 * what they kept in an earlier session goes) even when they were never opened this time. A test
 * checks the list against every module that calls keptForAccount.
 */
export const STORE_MODULES = import.meta.glob(["./api.ts", "./progress.ts", "./bookmarks.ts", "./deviceStorage.ts", "./ink.ts"]);

const allStores = async () => {
  await Promise.allSettled(Object.values(STORE_MODULES).map((load) => load()));
  return [...stores];
};

/** Sends the changes made on this device that wait for the server (positions, bookmarks, handwriting). */
export async function sendAccountChanges() {
  const pending = (await allStores()).flatMap((s) => (s.flush ? [s.flush] : []));
  return Promise.allSettled(pending.map(async (flush) => flush()));
}

/**
 * Forgets what this device keeps for the signed-out account: the library data and covers kept
 * for offline use (and the Android app's copy of the session), the library snapshots, the
 * downloaded books, and changes not yet sent (positions, bookmarks, handwriting).
 */
export async function forgetAccount() {
  await Promise.allSettled((await allStores()).map(async (s) => s.forget()));
}

// ---------- Library snapshots ----------

/**
 * Last-known library kept in localStorage so a cold start (the Android app especially) can paint
 * real numbers on the first frame instead of empty placeholders. It is only a first guess: the
 * provider's network `refresh` overwrites it a moment later.
 *
 * Everything is keyed by user id so one account never sees another's cached data.
 */
export type Snapshots = { books: Book[]; me: Me; folders: Folder[] };

const SNAPSHOT_KEYS: Record<keyof Snapshots, string> = { books: "readsync.books", me: "readsync.me", folders: "readsync.folders" };

/** Namespaced by user so signing in as someone else starts from a clean slate. */
const snapshotKey = (kind: keyof Snapshots, userId: string) => `${SNAPSHOT_KEYS[kind]}.${userId}`;

/**
 * Set by signing out until an account's library opens again (`openAccount`): the library closing
 * behind the sign-out saves its list once more, and that write must not bring the signed-out
 * account's books back. Reading a snapshot meanwhile doesn't lift it.
 */
let forgotten = false;

/**
 * An account's library opens (signing in, or signing out didn't happen and the account is still
 * signed in): its snapshots are kept again.
 */
export function openAccount() {
  forgotten = false;
}

/** The account's last-known `kind`, or null (lists that aren't lists count as missing). */
export function loadSnapshot<K extends keyof Snapshots>(kind: K, userId: string): Snapshots[K] | null {
  const value = readJson<unknown>(snapshotKey(kind, userId), null);
  if (kind !== "me" && !Array.isArray(value)) return null;
  return value as Snapshots[K] | null;
}

export function saveSnapshot<K extends keyof Snapshots>(kind: K, userId: string, value: Snapshots[K]) {
  if (!forgotten) writeJson(snapshotKey(kind, userId), value);
}

// Every account's snapshots go: the device keeps none for an account no longer signed in.
keptForAccount({
  forget() {
    forgotten = true;
    removeKeysWithPrefix(...Object.values(SNAPSHOT_KEYS).map((base) => `${base}.`));
  },
});

// ---------- Offline copies of library reads ----------

const openOfflineCache = () => ("caches" in window ? caches.open(OFFLINE_CACHE).catch(() => null) : Promise.resolve(null));

/** Whether an answer is the copy kept for offline use (the server couldn't be reached), not the server's. */
export const isOfflineCopy = (res: Response) => res.headers.has(OFFLINE_COPY_HEADER);

/**
 * The answer to `path`, from `fromServer`, with the offline copy the service worker keeps on the
 * web: the Android app has no service worker, so here the server's good answers to the reads in
 * lib/offlineCopies.ts are kept, and the last one answers when the server can't be reached
 * (marked, see isOfflineCopy). A kept cover is used without asking the server. On the web, and
 * for anything else, it is just `fromServer`.
 */
export async function withOfflineCopy(path: string, fromServer: () => Promise<Response>, method = "GET") {
  if (!isNative || method !== "GET") return fromServer();
  if (KEPT_COVER.test(path)) return keptFirst(path, fromServer);
  if (!OFFLINE_COPIES.some((c) => c.native && c.path.test(path))) return fromServer();
  try {
    const res = await fromServer();
    if (res.ok) {
      const copy = res.clone();
      void openOfflineCache()
        .then((cache) => cache?.put(path, copy))
        .catch(() => {});
    }
    return res;
  } catch (err) {
    const copy = await (await openOfflineCache())?.match(path).catch(() => undefined);
    if (!copy) throw err;
    const headers = new Headers(copy.headers);
    headers.set(OFFLINE_COPY_HEADER, "1");
    return new Response(copy.body, { status: copy.status, headers });
  }
}

/** The kept answer if there is one; otherwise the server's, kept when good. */
async function keptFirst(path: string, fromServer: () => Promise<Response>) {
  const cache = await openOfflineCache();
  const kept = await cache?.match(path).catch(() => undefined);
  if (kept) return kept;
  const res = await fromServer();
  if (res.ok && cache) void cache.put(path, res.clone()).catch(() => {});
  return res;
}

// Signing out drops the offline copies: the service worker's, and the Android app's (same cache,
// kept here without a service worker).
keptForAccount({
  async forget() {
    navigator.serviceWorker?.controller?.postMessage("signed-out");
    if ("caches" in window) await caches.delete(OFFLINE_CACHE);
  },
});
