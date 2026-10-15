import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * On the web the app and API share an origin (Caddy proxies /api), so requests are
 * relative and authenticated with an httpOnly cookie.
 * Inside the Capacitor app the API is remote, so we use an absolute URL and a
 * bearer token (cookies across origins are unreliable in Android WebViews).
 */
export const isNative = Capacitor.isNativePlatform();
export const API_BASE: string = isNative ? (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") : "";

const TOKEN_KEY = "readsync.authToken";
let token: string | null = null;

export async function loadToken() {
  if (!isNative) return;
  token = (await Preferences.get({ key: TOKEN_KEY })).value;
}

export function getToken() {
  return token;
}

export async function setToken(value: string | null) {
  token = value;
  if (!isNative) return;
  if (value) await Preferences.set({ key: TOKEN_KEY, value });
  else await Preferences.remove({ key: TOKEN_KEY });
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

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
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
  /** Blurb from the file's metadata or the catalog. */
  description: string | null;
  createdAt: string;
  progress: Progress | null;
};

/** Extra facts for a book's page. */
export type BookAbout = {
  /** Other accounts with this file in their library. */
  readers: number;
  /** The public-library entry for this file, if it was published. */
  publicBookId: string | null;
  source: { name: string; url: string } | null;
  subjects: string[];
};

/** A book in the public library, as other accounts see it. */
export type PublicBook = Pick<Book, "id" | "title" | "author" | "format" | "filename" | "sizeBytes" | "hasCover" | "description"> & {
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

/** A public book's page: also how many people have it and its catalog subjects. */
export type PublicBookDetails = PublicBook & { readers: number; subjects: string[] };

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
