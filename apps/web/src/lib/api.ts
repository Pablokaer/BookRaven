import { Preferences } from "@capacitor/preferences";
import { isOfflineCopy, keptForAccount, withOfflineCopy } from "./accountData";
import { isNative } from "./platform";

/**
 * On the web the app and API share an origin (Caddy proxies /api), so requests are
 * relative and authenticated with an httpOnly cookie.
 * Inside the Capacitor app the API is remote, so we use an absolute URL and a
 * bearer token (cookies across origins are unreliable in Android WebViews).
 */
export { isNative };
export const API_BASE: string = isNative ? (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") : "";

const TOKEN_KEY = "readsync.authToken";
const USER_KEY = "readsync.sessionUser";
let token: string | null = null;

/** Who is signed in: what the app shows of the account. */
export type SessionUser = { id: string; name: string; email: string };

/** Native app: the account the saved token signs in, as the server last said. */
let lastUser: SessionUser | null = null;

export async function loadToken() {
  if (!isNative) return;
  const [saved, user] = await Promise.all([Preferences.get({ key: TOKEN_KEY }), Preferences.get({ key: USER_KEY })]);
  token = saved.value;
  try {
    lastUser = token && user.value ? (JSON.parse(user.value) as SessionUser) : null;
  } catch {
    lastUser = null;
  }
}

export function getToken() {
  return token;
}

export async function setToken(value: string | null) {
  // Another token (or none): the account kept for opening offline was the old one's.
  if (value !== token) await rememberUser(null);
  token = value;
  if (!isNative) return;
  if (value) await Preferences.set({ key: TOKEN_KEY, value });
  else await Preferences.remove({ key: TOKEN_KEY });
}

/**
 * Native app: the account to open the app as when the server can't be reached (on the web the
 * service worker keeps the session). Null without a saved token.
 */
export const offlineUser = () => (isNative && token ? lastUser : null);

/** Native app: keeps who the saved token signs in (null forgets it). */
export async function rememberUser(user: SessionUser | null) {
  if (!isNative) return;
  const next = user && { id: user.id, name: user.name, email: user.email };
  if (JSON.stringify(next) === JSON.stringify(lastUser)) return;
  lastUser = next;
  if (next) await Preferences.set({ key: USER_KEY, value: JSON.stringify(next) });
  else await Preferences.remove({ key: USER_KEY });
}

// Signing out forgets it with the token (setToken does too); kept here for any other way out.
keptForAccount({ forget: () => rememberUser(null) });

/**
 * A failed session check that leaves the session standing: no connection or the server down,
 * not the server turning it down (401/403).
 */
export function sessionUnreachable(error: unknown) {
  const status = (error as { status?: number } | null | undefined)?.status;
  return !!error && status !== 401 && status !== 403;
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
  if (res.status === 401) window.dispatchEvent(new Event("readsync:unauthorized"));
  return res;
}

/** A JSON answer, and whether it is the copy kept for offline use (the server couldn't be reached). */
export async function apiAnswer<T>(path: string, init: RequestInit = {}): Promise<{ body: T; offline: boolean }> {
  // The Android app keeps library reads for offline use itself (lib/accountData.ts).
  const res = await withOfflineCopy(path, () => apiFetch(path, init), init.method);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return { body: body as T, offline: isOfflineCopy(res) };
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await apiAnswer<T>(path, init)).body;
}

/** A request whose answer has nothing to read: throws an ApiError when it fails. */
export async function apiOk(path: string, init: RequestInit = {}) {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
}

/** Deletes something; a 404 counts as done (it is already gone). */
export async function apiDelete(path: string) {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}

// ---------- Types shared with the API ----------

export type Progress = {
  bookId?: string;
  locator: string;
  percentage: number;
  label: string | null;
  deviceId: string | null;
  deviceName: string | null;
  updatedAt: string;
};

export type Book = {
  id: string;
  title: string;
  author: string | null;
  format: "pdf" | "epub" | "mobi" | "azw3" | "fb2" | "cbz" | "cbr" | "cb7" | "cbt";
  filename: string;
  sizeBytes: number;
  hasCover: boolean;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  /** This book has an active share link. */
  isShared: boolean;
  /** Name of the person whose share link this book was added from. */
  sharedBy: string | null;
  sharedAt: string | null;
  /** Published in the public library. */
  isPublic: boolean;
  /** ISO 639-1 code, when known. */
  language: string | null;
  /**
   * Blurb from the file's metadata or the catalog: only `GET /api/books/:id` has it (the book's
   * page reads it from `BookAbout`), the library list and live events leave it out.
   */
  description?: string | null;
  createdAt: string;
  progress: Progress | null;
};

/** Extra facts for a book's page. */
export type BookAbout = {
  /** Blurb from the file's metadata or the catalog. */
  description: string | null;
  /** Other accounts with this file in their library. */
  readers: number;
  /** The public-library entry for this file, if it was published. */
  publicBookId: string | null;
  source: { name: string; url: string } | null;
  subjects: string[];
};

/** A book in the public library, as other accounts see it. */
export type PublicBook = Pick<Book, "id" | "title" | "author" | "format" | "filename" | "sizeBytes" | "hasCover"> & {
  /** ISO 639-1 code, when known. */
  language: string | null;
  /** Set for public-domain books imported from a catalog such as Project Gutenberg. */
  source: { name: string; url: string } | null;
  /** Library sections, e.g. "philosophy", "economics". */
  themes: string[];
  /** Downloads at the source (a popularity signal); null for books people published. */
  popularity: number | null;
  publishedBy: string | null;
  publishedAt: string;
  /** The viewer's own copy of this file, if any. */
  ownBookId: string | null;
  isMine: boolean;
  canRemove: boolean;
};

/** A public book's page: also its description (not in the catalog list), how many people have it and its catalog subjects. */
export type PublicBookDetails = PublicBook & { description: string | null; readers: number; subjects: string[] };

/** The signed-in account. `quotaBytes` is null when storage is unlimited (administrators). */
export type Me = { isAdmin: boolean; usedBytes: number; quotaBytes: number | null };

export type Folder = { id: string; name: string; createdAt: string };

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export type Highlight = {
  id: string;
  bookId: string;
  /** EPUB CFI range of the highlighted passage. */
  cfi: string;
  text: string;
  color: HighlightColor;
  /** Chapter title, when known. */
  label: string | null;
  /** The reader's own note on the passage. */
  note: string | null;
  createdAt: string;
};

/** A bookmarked page. */
export type Bookmark = {
  id: string;
  bookId: string;
  /** The page: "page:N" (PDFs) or where the page starts (EPUB CFI; comics too). */
  locator: string;
  percentage: number;
  /** Where it is: "Page 3 of 120" or the chapter title. */
  label: string | null;
  /** The reader's own name for it. */
  title: string | null;
  createdAt: string;
};

export type ServerConfig = {
  googleEnabled: boolean;
  allowSignup: boolean;
  maxUploadMb: number;
  passwordResetEnabled: boolean;
  requireEmailVerification: boolean;
  dictionaryEnabled: boolean;
  translateEnabled: boolean;
};

let config: Promise<ServerConfig> | null = null;

/** The server's settings, fetched once per app session (they only change when the server restarts); a failure is tried again next time. */
export function serverConfig(): Promise<ServerConfig> {
  if (!config) {
    const p = apiJson<ServerConfig>("/api/config");
    p.catch(() => config === p && (config = null));
    config = p;
  }
  return config;
}
