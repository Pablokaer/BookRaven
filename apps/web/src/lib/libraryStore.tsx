import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { loadSnapshot, openAccount, saveSnapshot } from "./accountData";
import { ApiError, serverConfig, type Book, type Folder } from "./api";
import { deleteBook, listBooks, SUPPORTED_EXTENSIONS, uploadBook } from "./books";
import { forgetDeviceBook, makeRoom, pruneDeviceBooks } from "./deviceStorage";
import { eventsConnected, onServerEvent } from "./events";
import { afterIdle } from "./idle";
import { createFolder, deleteFolder, listFolders, renameFolder, updateBook } from "./library";
import { createLibrary, emptyLibrary, type Activity, type LibraryState } from "./libraryState";
import { forgetPublicBooks, getMe } from "./publicLibrary";
import { onPositionChange } from "./progress";
import { STORAGE_FULL } from "./rangeFile";
import { matchesText } from "./search";
import { createUploadQueue, isActiveUpload, type UploadEntry, type UploadItem } from "./uploadQueue";
import { useLatest } from "./useLatest";

export { isActiveUpload, type UploadEntry, type UploadItem, type UploadStatus } from "./uploadQueue";
export type { Activity } from "./libraryState";

/** Back on the tab, the library is reloaded unless live events kept it current this recently. */
const FRESH_FOR = 60_000;
/** Storage use is asked for at most this often (adding or removing many books at once). */
const ME_DEBOUNCE = 500;

/** What the library knows: changes whenever the books, collections, activity… change. */
type LibraryData = LibraryState & {
  activity: Activity[];
  unreadActivity: number;
  /** Global search from the top bar. */
  query: string;
  /** Dialogs hosted by the app shell. */
  sharing: Book | null;
  organizing: Book | null;
};

/**
 * What can be done with the library. These never change, so components that only act on books
 * (the buttons on every book card) don't re-render when the library does.
 */
export type LibraryActions = {
  refreshMe: () => void;
  markActivityRead: () => void;
  setQuery: (q: string) => void;

  /** Opens the file picker; the files go into `folderId` when given. */
  pickFiles: (folderId?: string | null) => void;
  /** Queues files for upload (into a collection when `folderId` is given), optionally with known metadata and tags. */
  upload: (files: FileList | (File | UploadEntry)[], folderId?: string | null) => void;
  removeBook: (book: Book) => Promise<void>;
  toggleFavorite: (book: Book) => Promise<void>;
  replaceBook: (book: Book) => void;
  /** The library's current copy of a book, read without subscribing to library changes. */
  getBook: (id: string) => Book | undefined;

  /** Creates a collection: asks for its name unless one is given (an existing one with that name is reused). */
  addFolder: (name?: string) => Promise<Folder | null>;
  renameFolderPrompt: (folder: Folder) => Promise<void>;
  removeFolder: (folder: Folder) => Promise<boolean>;

  openShare: (book: Book | null) => void;
  openOrganize: (book: Book | null) => void;
};

type LibraryCtx = LibraryData & LibraryActions;

/** The upload list, apart from the rest: it changes many times a second while files are sent. */
type UploadsCtx = {
  uploads: UploadItem[];
  /** Removes finished uploads from the list. */
  clearUploads: () => void;
};

const Ctx = createContext<LibraryCtx | null>(null);
const ActionsCtx = createContext<LibraryActions | null>(null);
const UploadsContext = createContext<UploadsCtx | null>(null);

/**
 * The library's state (lib/libraryState: the reducer fed live events and this app's changes) and
 * upload queue (lib/uploadQueue), wired to the server, the device and React.
 */
function connect(userId: { current: string }) {
  let meTimer: ReturnType<typeof setTimeout> | undefined;
  const loadMe = () => {
    getMe()
      .then((me) => library.dispatch({ type: "me.loaded", me }))
      .catch(() => {});
  };
  const refreshMe = () => {
    clearTimeout(meTimer);
    meTimer = setTimeout(loadMe, ME_DEBOUNCE);
  };

  /** When the books list last loaded from the server. */
  let refreshedAt = 0;
  const refresh = () => {
    listBooks()
      .then(({ books, offline }) => {
        library.dispatch({ type: "books.loaded", books });
        if (offline) return;
        refreshedAt = Date.now();
        // Books deleted on another device meanwhile: what this device kept of them goes too. Only
        // by the server's own list (never the copy kept for offline use), with books added since.
        afterIdle(() => void pruneDeviceBooks(new Set((library.get().books ?? books).map((x) => x.id))).catch(() => {}));
      })
      .catch(() => library.dispatch({ type: "books.unavailable" }));
    listFolders()
      .then((folders) => library.dispatch({ type: "folders.loaded", folders }))
      .catch(() => library.dispatch({ type: "folders.loaded" }));
  };

  // The account's library opens: its snapshots are kept again (after a sign-out, lib/accountData).
  openAccount();
  // Hydrate instantly from the last snapshot kept in localStorage (keyed by user), so a cold
  // start shows real numbers on the first frame; `refresh()` updates them over the network.
  const savedFolders = loadSnapshot("folders", userId.current);
  const library = createLibrary(
    {
      ...emptyLibrary(),
      books: loadSnapshot("books", userId.current),
      folders: savedFolders ?? [],
      foldersReady: savedFolders !== null,
      me: loadSnapshot("me", userId.current),
    },
    {
      context: () => ({ userId: userId.current }),
      run: (effect) => {
        if (effect.type === "reload") refresh();
        else if (effect.type === "refreshMe") refreshMe();
        else void forgetDeviceBook(effect.bookId).catch(() => {});
      },
    },
  );

  // The server's size limit for one file, so a file too large is refused before it is sent.
  let maxUploadBytes: number | undefined;
  void serverConfig()
    .then((c) => (maxUploadBytes = c.maxUploadMb * 1024 * 1024))
    .catch(() => {});

  const uploads = createUploadQueue({
    uploader: { upload: uploadBook, update: updateBook },
    hooks: {
      uploaded: (book) => {
        library.dispatch({ type: "book.uploaded", book });
        // The public catalog says which books are the viewer's own: without waiting for the live event.
        forgetPublicBooks();
      },
      moved: (book) => library.dispatch({ type: "book.replaced", book }),
      settled: refreshMe,
      quotaBytes: () => library.get().me?.quotaBytes,
      maxUploadBytes: () => maxUploadBytes,
    },
  });

  /** Starts listening (live events, positions, coming back to the tab); returns the stop. */
  const start = () => {
    refresh();
    loadMe();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (eventsConnected() && Date.now() - refreshedAt < FRESH_FOR) return;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const off = onServerEvent((type, data) => library.dispatch({ type, data } as Parameters<typeof library.dispatch>[0]));
    // A book's position changed (on any device): the list shows it, and says so when it was elsewhere.
    const offPositions = onPositionChange((progress, elsewhere) => library.dispatch({ type: "position", progress, elsewhere }));
    return () => {
      off();
      offPositions();
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(meTimer);
      uploads.dispose();
    };
  };

  return { library, uploads, refreshMe, start };
}

export function LibraryProvider({ children, userId }: { children: ReactNode; userId: string }) {
  /** The signed-in user's id, to skip notifications about their own actions. */
  const userIdRef = useLatest(userId);
  const [{ library, uploads: queue, refreshMe, start }] = useState(() => connect(userIdRef));
  const state = useSyncExternalStore(library.subscribe, library.get);
  const uploads = useSyncExternalStore(queue.subscribe, queue.items);
  const { books, me, folders, foldersReady } = state;
  const [readAt, setReadAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [sharing, setSharing] = useState<Book | null>(null);
  const [organizing, setOrganizing] = useState<Book | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFolderRef = useRef<string | null>(null);

  // Keep the localStorage snapshot in step with every change (network refresh, live events,
  // optimistic edits), so the next cold start hydrates from the latest known state. `books`
  // changes on every reading position (this device's own too), so the snapshot is written at
  // most every 2 s, and right away when the page is hidden or closed and when the library closes
  // (after signing out it is not kept: lib/accountData.ts).
  const snapshot = useRef<{ userId: string; books: Book[] } | null>(null);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveBooksSnapshot = useCallback(() => {
    clearTimeout(snapshotTimer.current);
    snapshotTimer.current = undefined;
    if (snapshot.current) saveSnapshot("books", snapshot.current.userId, snapshot.current.books);
    snapshot.current = null;
  }, []);
  useEffect(() => {
    if (!books) return;
    if (snapshot.current && snapshot.current.userId !== userId) saveBooksSnapshot();
    snapshot.current = { userId, books };
    snapshotTimer.current ??= setTimeout(saveBooksSnapshot, 2000);
  }, [books, userId, saveBooksSnapshot]);
  useEffect(() => {
    const onHidden = () => document.visibilityState === "hidden" && saveBooksSnapshot();
    window.addEventListener("pagehide", saveBooksSnapshot);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", saveBooksSnapshot);
      document.removeEventListener("visibilitychange", onHidden);
      saveBooksSnapshot();
    };
  }, [saveBooksSnapshot]);
  useEffect(() => {
    if (me) saveSnapshot("me", userId, me);
  }, [me, userId]);
  useEffect(() => {
    if (foldersReady) saveSnapshot("folders", userId, folders);
  }, [folders, foldersReady, userId]);

  // A book's pieces found no room on the device: books read least recently make some.
  useEffect(() => {
    const onFull = () => void makeRoom();
    window.addEventListener(STORAGE_FULL, onFull);
    return () => window.removeEventListener(STORAGE_FULL, onFull);
  }, []);

  // The public catalog says which books are the viewer's own: the next account gets its own.
  useEffect(() => forgetPublicBooks, [userId]);

  useEffect(start, [start]);

  // Closing or reloading the page would cancel the uploads still going: ask first.
  const hasActiveUploads = uploads.some(isActiveUpload);
  useEffect(() => {
    if (!hasActiveUploads) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasActiveUploads]);

  const actions = useMemo<LibraryActions>(() => {
    const replaceBook = (book: Book) => library.dispatch({ type: "book.replaced", book });
    const collectionError = (err: unknown, action: string) =>
      window.alert(err instanceof ApiError && err.status === 409 ? "A collection with this name already exists." : `Could not ${action} the collection.`);
    return {
      refreshMe,
      markActivityRead: () => setReadAt(Date.now()),
      setQuery,
      pickFiles: (folderId) => {
        pickFolderRef.current = folderId ?? null;
        inputRef.current?.click();
      },
      upload: (files, folderId) => queue.add(files, folderId),
      removeBook: async (book) => {
        if (!window.confirm(`Delete "${book.title}" from your library on all devices?`)) return;
        await deleteBook(book.id);
        forgetPublicBooks(); // it may have been the viewer's copy of a public book
        await forgetDeviceBook(book.id);
        library.dispatch({ type: "book.removed", id: book.id });
        refreshMe();
      },
      toggleFavorite: async (book) => {
        const favorite = !book.favorite;
        replaceBook({ ...book, favorite });
        try {
          replaceBook(await updateBook(book.id, { favorite }));
        } catch {
          replaceBook(book);
        }
      },
      replaceBook,
      getBook: (id) => library.get().books?.find((b) => b.id === id),
      addFolder: async (given) => {
        const name = (given ?? window.prompt("Collection name"))?.trim();
        if (!name) return null;
        if (given) {
          const existing = library.get().folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
          if (existing) return existing;
        }
        try {
          const folder = await createFolder(name);
          library.dispatch({ type: "folder.saved", folder });
          return folder;
        } catch (err) {
          collectionError(err, "create");
          return null;
        }
      },
      renameFolderPrompt: async (folder) => {
        const name = window.prompt("Rename collection", folder.name)?.trim();
        if (!name || name === folder.name) return;
        try {
          library.dispatch({ type: "folder.saved", folder: await renameFolder(folder.id, name) });
        } catch (err) {
          collectionError(err, "rename");
        }
      },
      removeFolder: async (folder) => {
        if (!window.confirm(`Delete the collection "${folder.name}"? Its books stay in your library.`)) return false;
        await deleteFolder(folder.id);
        library.dispatch({ type: "folder.removed", id: folder.id });
        return true;
      },
      openShare: setSharing,
      openOrganize: setOrganizing,
    };
  }, [library, queue, refreshMe]);

  const { activity } = state;
  const unreadActivity = useMemo(() => activity.filter((a) => a.at > readAt).length, [activity, readAt]);
  const value = useMemo<LibraryCtx>(
    () => ({ ...actions, ...state, unreadActivity, query, sharing, organizing }),
    [actions, state, unreadActivity, query, sharing, organizing],
  );

  const uploadsValue = useMemo<UploadsCtx>(() => ({ uploads, clearUploads: queue.clear }), [uploads, queue]);

  return (
    <ActionsCtx.Provider value={actions}>
      <Ctx.Provider value={value}>
        <UploadsContext.Provider value={uploadsValue}>{children}</UploadsContext.Provider>
      </Ctx.Provider>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={SUPPORTED_EXTENSIONS.join(",")}
        onChange={(e) => {
          if (e.target.files) queue.add(e.target.files, pickFolderRef.current);
          e.target.value = "";
        }}
      />
    </ActionsCtx.Provider>
  );
}

/** The library's data and actions; re-renders whenever the library changes. */
export function useLibrary() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLibrary outside LibraryProvider");
  return ctx;
}

/** The library's actions only: never re-renders on library changes. */
export function useLibraryActions() {
  const ctx = useContext(ActionsCtx);
  if (!ctx) throw new Error("useLibraryActions outside LibraryProvider");
  return ctx;
}

/** Files being uploaded (for the upload panel). */
export function useUploads() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error("useUploads outside LibraryProvider");
  return ctx;
}

/** Books matching the top-bar search: title, author, tags or collection name. */
export function matchesQuery(book: Book, query: string, folders: Folder[]) {
  if (!query.trim()) return true;
  const folder = book.folderId ? folders.find((f) => f.id === book.folderId)?.name ?? "" : "";
  return matchesText(`${book.title} ${book.author ?? ""} ${book.tags.join(" ")} ${folder}`, query);
}
