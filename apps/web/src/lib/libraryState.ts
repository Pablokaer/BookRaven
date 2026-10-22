import type { Book, Folder, Me, Progress } from "./api";
import type { ServerEvent } from "./events";
import { percent } from "./format";

/**
 * What the library knows (books, collections, the account's storage use, and counters the pages
 * showing the public library, requests and clubs reload on), and how it changes: a pure reducer
 * fed live server events and this app's own changes, plus a small store around it for the
 * provider (lib/libraryStore.tsx). Tests feed the reducer sequences of events.
 */
export type LibraryState = {
  books: Book[] | null;
  folders: Folder[];
  /** False until the collections list has loaded once. */
  foldersReady: boolean;
  /** Role and storage use of the signed-in account (null until loaded). */
  me: Me | null;
  /** Bumped whenever the public library changes anywhere, so its page can reload. */
  publicVersion: number;
  /** Same for book requests. */
  requestsVersion: number;
  /** Bumped when anything changes in one of the user's book clubs. */
  clubsVersion: number;
};

/** This app's own changes to the library (loads, optimistic edits, uploads). */
export type LibraryAction =
  | { type: "books.loaded"; books: Book[] }
  /** The list could not load: an empty library rather than none at all (unless one is shown). */
  | { type: "books.unavailable" }
  /** The collections list answered (`folders` when it loaded). */
  | { type: "folders.loaded"; folders?: Folder[] }
  | { type: "me.loaded"; me: Me }
  /** A book's position changed (on any device): `elsewhere` when it was reached on another one. */
  | { type: "position"; progress: Progress & { bookId: string }; elsewhere: boolean }
  /** A book edited here (or the server's answer to an edit). */
  | { type: "book.replaced"; book: Book }
  | { type: "book.removed"; id: string }
  /** A book uploaded from this device. */
  | { type: "book.uploaded"; book: Book }
  /** A collection created or renamed here. */
  | { type: "folder.saved"; folder: Folder }
  | { type: "folder.removed"; id: string };

export type LibraryInput = ServerEvent | LibraryAction;

/** A line for the activity panel. */
export type Note = { text: string; bookId?: string };

/** Work the provider does after an input: reload the lists, ask for storage use, forget a book's files. */
export type LibraryEffect = { type: "reload" } | { type: "refreshMe" } | { type: "forgetDeviceBook"; bookId: string };

export type LibraryResult = { state: LibraryState; notes: Note[]; effects: LibraryEffect[] };

/** `userId`: the signed-in account, so its own club messages are not announced to it. */
export type LibraryContext = { userId: string };

export const emptyLibrary = (): LibraryState => ({
  books: null,
  folders: [],
  foldersReady: false,
  me: null,
  publicVersion: 0,
  requestsVersion: 0,
  clubsVersion: 0,
});

export const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Most recent activity first (reading, else when it was added). */
export function sortBooks(books: Book[]) {
  return books
    .map((book) => ({ book, at: Date.parse(book.progress?.updatedAt ?? book.createdAt) }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.book);
}

const mapBooks = (books: Book[] | null, fn: (b: Book) => Book) => books?.map(fn) ?? books;
const upsertFolder = (folders: Folder[], folder: Folder) => [...folders.filter((f) => f.id !== folder.id), folder].sort(byName);
/** A collection is gone: its books stay, in no collection. */
const unfile = (books: Book[] | null, folderId: string) => mapBooks(books, (b) => (b.folderId === folderId ? { ...b, folderId: null } : b));

/** The library after `input`, with the activity lines and the work it calls for. */
export function reduceLibrary(state: LibraryState, input: LibraryInput, ctx: LibraryContext): LibraryResult {
  const notes: Note[] = [];
  const effects: LibraryEffect[] = [];
  const next = (patch: Partial<LibraryState>): LibraryResult => ({ state: { ...state, ...patch }, notes, effects });
  const same = (): LibraryResult => ({ state, notes, effects });

  switch (input.type) {
    // ---- Live server events ----
    case "reconnected":
      // Events sent while disconnected were missed: reload everything they would have updated.
      effects.push({ type: "reload" }, { type: "refreshMe" });
      return next({ publicVersion: state.publicVersion + 1, requestsVersion: state.requestsVersion + 1, clubsVersion: state.clubsVersion + 1 });
    case "public.changed":
      return next({ publicVersion: state.publicVersion + 1 });
    case "requests.changed":
      return next({ requestsVersion: state.requestsVersion + 1 });
    case "request.fulfilled":
      notes.push({ text: `Your request “${input.data.title}” was answered: it is in the Public Library now` });
      return next({ requestsVersion: state.requestsVersion + 1 });
    case "club.message": {
      const { author, fromId, clubName } = input.data;
      if (author && fromId !== ctx.userId) notes.push({ text: `${author} wrote in “${clubName}”` });
      return next({ clubsVersion: state.clubsVersion + 1 });
    }
    case "club.progress":
    case "club.member":
    case "club.deleted":
      return next({ clubsVersion: state.clubsVersion + 1 });
    case "admin.report":
      notes.push({ text: `New report about “${input.data.title}” is waiting in the admin panel` });
      return same();
    case "folder.created":
    case "folder.updated":
      return next({ folders: upsertFolder(state.folders, input.data) });
    case "folder.deleted":
      return next({ folders: state.folders.filter((f) => f.id !== input.data.id), books: unfile(state.books, input.data.id) });
    case "book.created": {
      // Storage use changes whenever a book is added or removed (from any device).
      effects.push({ type: "refreshMe" });
      const book = input.data;
      // Books uploaded from this device are already in the list; anything else came from elsewhere.
      const known = state.books?.some((b) => b.id === book.id);
      if (!known) notes.push({ text: `“${book.title}” was added to your library`, bookId: book.id });
      return !state.books || known ? same() : next({ books: sortBooks([book, ...state.books]) });
    }
    case "book.updated":
      return next({ books: mapBooks(state.books, (b) => (b.id === input.data.id ? input.data : b)) });
    case "book.deleted":
      effects.push({ type: "refreshMe" }, { type: "forgetDeviceBook", bookId: input.data.id });
      return next({ books: state.books?.filter((b) => b.id !== input.data.id) ?? state.books });
    case "progress.updated":
      // Positions reach the library through lib/progress (`onPositionChange`), as "position".
      return same();

    // ---- This app's own changes ----
    case "books.loaded":
      return next({ books: sortBooks(input.books) });
    case "books.unavailable":
      return state.books ? same() : next({ books: [] });
    case "folders.loaded":
      return next({ foldersReady: true, ...(input.folders ? { folders: [...input.folders].sort(byName) } : {}) });
    case "me.loaded":
      return next({ me: input.me });
    case "position": {
      const p = input.progress;
      if (input.elsewhere) {
        const title = state.books?.find((b) => b.id === p.bookId)?.title;
        if (title) notes.push({ text: `Reached ${percent(p.percentage)} of “${title}” on ${p.deviceName ?? "another device"}`, bookId: p.bookId });
      }
      return state.books ? next({ books: sortBooks(state.books.map((b) => (b.id === p.bookId ? { ...b, progress: p } : b))) }) : same();
    }
    case "book.replaced":
      return next({ books: mapBooks(state.books, (b) => (b.id === input.book.id ? input.book : b)) });
    case "book.removed":
      return next({ books: state.books?.filter((b) => b.id !== input.id) ?? state.books });
    case "book.uploaded": {
      const book = input.book;
      notes.push({ text: `Uploaded “${book.title}”`, bookId: book.id });
      return state.books?.some((b) => b.id === book.id) ? same() : next({ books: sortBooks([book, ...(state.books ?? [])]) });
    }
    case "folder.saved":
      return next({ folders: upsertFolder(state.folders, input.folder) });
    case "folder.removed":
      return next({ folders: state.folders.filter((f) => f.id !== input.id), books: unfile(state.books, input.id) });
    default:
      // A live event the library does not show (bookmarks, highlights, handwriting, settings).
      return same();
  }
}

/** Things that happened while the app was open (uploads, progress from other devices…). */
export type Activity = { id: string; text: string; at: number; bookId?: string };

/** The activity panel keeps this many lines. */
const ACTIVITY_KEPT = 30;

export type LibraryView = LibraryState & { activity: Activity[] };

/**
 * The library state held outside React: `dispatch` runs the reducer, adds its notes to the
 * activity list (newest first), hands its effects to `run`, and tells subscribers.
 */
export function createLibrary(initial: LibraryState, options: { context: () => LibraryContext; run: (effect: LibraryEffect) => void }) {
  let view: LibraryView = { ...initial, activity: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch(input: LibraryInput) {
      const { activity, ...state } = view;
      const result = reduceLibrary(state, input, options.context());
      if (result.state !== state || result.notes.length) {
        const now = Date.now();
        const added = result.notes.reverse().map((n) => ({ id: `${now}-${Math.random()}`, text: n.text, at: now, bookId: n.bookId }));
        view = { ...result.state, activity: added.length ? [...added, ...activity].slice(0, ACTIVITY_KEPT) : activity };
        listeners.forEach((l) => l());
      }
      result.effects.forEach(options.run);
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
