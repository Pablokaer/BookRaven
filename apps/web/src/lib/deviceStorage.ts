import { afterIdle } from "./idle";
import { BOOK_CACHE, forgetOpenedFile, forgetSaved } from "./rangeFile";
import { readJson, removeKey, writeJson } from "./storage";

/**
 * The books kept on this device (lib/rangeFile.ts saves their pieces and files in Cache
 * Storage): when each was last opened, and which were saved for offline on purpose. When the
 * browser runs short of space the books read least recently make room; saved ones stay.
 */

/** Cache Storage key of a book's file saved on this device (`.cbz`: the CBZ copy of a RAR/7z/TAR comic). */
export const savedKey = (id: string, cbz = false) => `/books/${id}${cbz ? ".cbz" : ""}`;

export type DeviceBook = { openedAt: number; kept?: boolean };
type DeviceBooks = Record<string, DeviceBook>;

const KEY = "readsync.deviceBooks";
/** Above this share of the browser's quota, books not saved for offline make room. */
const TIGHT = 0.8;

const load = () => readJson<DeviceBooks>(KEY, {});
const save = (books: DeviceBooks) => writeJson(KEY, books);

let askedPersistence = false;
/** Asks the browser to keep the saved books when the device runs short of space (Chrome decides by itself, Firefox asks). */
function askPersistence() {
  if (askedPersistence || !navigator.storage?.persist) return;
  askedPersistence = true;
  void navigator.storage
    .persisted()
    .then((yes) => yes || navigator.storage.persist())
    .catch(() => {});
}

/** A book was opened (its pieces are being saved). The first one on this device asks to keep them for good. */
export function noteOpened(id: string) {
  const books = load();
  if (!Object.keys(books).length) askPersistence();
  books[id] = { ...books[id], openedAt: Date.now() };
  save(books);
  afterIdle(() => void makeRoom(), { delay: 5000 });
}

/** "Save for offline reading": the book stays until it is deleted or the reader clears the device. */
export function keepOnDevice(id: string) {
  askPersistence();
  const books = load();
  books[id] = { openedAt: Date.now(), kept: true };
  save(books);
}

/** Forgets everything saved on this device for a book (its file, CBZ copy and downloaded pieces). */
export async function forgetDeviceBook(id: string) {
  const books = load();
  if (books[id]) {
    delete books[id];
    save(books);
  }
  await forgetSaved(savedKey(id));
}

/** Ids of the books with anything saved in Cache Storage. */
async function cachedBookIds() {
  if (!("caches" in window)) return [];
  const ids = new Set<string>();
  for (const req of await (await caches.open(BOOK_CACHE)).keys()) {
    const id = /^\/books\/([^/.]+)/.exec(new URL(req.url).pathname)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Books gone from the library (deleted on another device): what this device kept of them goes too. */
export async function pruneDeviceBooks(libraryIds: Set<string>) {
  const books = load();
  const gone = Object.keys(books).filter((id) => !libraryIds.has(id));
  if (gone.length) {
    for (const id of gone) delete books[id];
    save(books);
  }
  for (const id of await cachedBookIds()) if (!libraryIds.has(id)) await forgetSaved(savedKey(id));
}

/**
 * The order in which saved books make room: least recently opened first (books saved before
 * this was tracked count as the oldest), never one saved for offline nor the one opened last.
 */
export function evictionOrder(cached: string[], books: DeviceBooks) {
  let newest: string | null = null;
  for (const [id, b] of Object.entries(books)) if (!newest || b.openedAt > books[newest]!.openedAt) newest = id;
  const openedAt = (id: string) => books[id]?.openedAt ?? 0;
  return cached.filter((id) => !books[id]?.kept && id !== newest).sort((a, b) => openedAt(a) - openedAt(b));
}

let makingRoom = false;
/** While the app's storage is near the browser's quota, drops saved books in evictionOrder. */
export async function makeRoom() {
  if (makingRoom || !navigator.storage?.estimate) return;
  makingRoom = true;
  const tight = async () => {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota > 0 && usage > quota * TIGHT;
  };
  try {
    if (!(await tight())) return;
    for (const id of evictionOrder(await cachedBookIds(), load())) {
      await forgetDeviceBook(id);
      if (!(await tight())) return;
    }
  } catch {
    /* nothing to free, or no way to tell */
  } finally {
    makingRoom = false;
  }
}

/** What the app keeps on this device: all of its storage as the browser counts it (null if it can't), and how many books. */
export async function deviceUsage() {
  const [estimate, ids] = await Promise.all([navigator.storage?.estimate?.().catch(() => null), cachedBookIds().catch(() => [])]);
  return { bytes: estimate?.usage ?? null, books: ids.length };
}

/** Removes every book kept on this device (signing out, or clearing them by hand); they download again when opened. */
export async function clearDeviceBooks() {
  forgetOpenedFile();
  removeKey(KEY);
  if ("caches" in window) await caches.delete(BOOK_CACHE);
}
