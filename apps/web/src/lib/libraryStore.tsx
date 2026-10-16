import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, type Book, type Folder, type Me, type Progress } from "./api";
import { deleteBook, forgetCachedBook, listBooks, SUPPORTED_EXTENSIONS, uploadBook, type Meta } from "./books";
import { deviceId } from "./device";
import { eventsConnected, onServerEvent, RECONNECTED } from "./events";
import { loadCachedBooks, loadCachedMe, saveCachedBooks, saveCachedMe } from "./libraryCache";
import { percent } from "./format";
import { fileSize } from "./format";
import { createFolder, deleteFolder, listFolders, renameFolder, updateBook } from "./library";
import { forgetPublicBooks, getMe } from "./publicLibrary";
import { matchesText } from "./search";

export type UploadStatus = "queued" | "preparing" | "uploading" | "processing" | "done" | "duplicate" | "error";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** Fraction of the file sent (0 to 1). */
  progress: number;
  message?: string;
  bookId?: string;
  /** Collection the file goes into. */
  folderId: string | null;
};

/** A file to upload with what is already known about it (an import from another app). */
export type UploadEntry = { file: File; meta?: Meta; tags?: string[] };

/** Still to finish: the page should not be closed. */
export const isActiveUpload = (u: UploadItem) => u.status === "queued" || u.status === "preparing" || u.status === "uploading" || u.status === "processing";

/** Things that happened while the app was open (uploads, progress from other devices…). */
export type Activity = { id: string; text: string; at: number; bookId?: string };

const UPLOAD_ERRORS: Record<string, string> = {
  duplicate: "Already in your library",
  unsupported_format: "Unsupported or DRM-protected file",
  file_too_large: "File is too large",
  network: "Network error, try again",
  quota_exceeded: "Storage limit reached",
};

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Most recent activity first (reading, else when it was added). */
function sortBooks(books: Book[]) {
  return books
    .map((book) => ({ book, at: Date.parse(book.progress?.updatedAt ?? book.createdAt) }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.book);
}

/** Back on the tab, the library is reloaded unless live events kept it current this recently. */
const FRESH_FOR = 60_000;
/** Storage use is asked for at most this often (adding or removing many books at once). */
const ME_DEBOUNCE = 500;

/** What the library knows: changes whenever the books, collections, activity… change. */
type LibraryData = {
  books: Book[] | null;
  folders: Folder[];
  /** Role and storage use of the signed-in account (null until loaded). */
  me: Me | null;
  /** Bumped whenever the public library changes anywhere, so its page can reload. */
  publicVersion: number;
  /** Same for book requests. */
  requestsVersion: number;
  /** Bumped when anything changes in one of the user's book clubs. */
  clubsVersion: number;
  /** False until the collections list has loaded once. */
  foldersReady: boolean;
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

/** Upload progress is shown at most this often (the browser reports it many times a second). */
const PROGRESS_INTERVAL = 100;

export function LibraryProvider({ children, userId }: { children: ReactNode; userId: string }) {
  // Hydrate instantly from the last snapshot kept in localStorage (keyed by user), so a cold
  // start shows real numbers on the first frame; `refresh()` below updates them over the network.
  const [books, setBooks] = useState<Book[] | null>(() => loadCachedBooks(userId));
  const [folders, setFolders] = useState<Folder[]>([]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const [foldersReady, setFoldersReady] = useState(false);
  const [me, setMe] = useState<Me | null>(() => loadCachedMe(userId));
  const [publicVersion, setPublicVersion] = useState(0);
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [clubsVersion, setClubsVersion] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [readAt, setReadAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [sharing, setSharing] = useState<Book | null>(null);
  const [organizing, setOrganizing] = useState<Book | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFolderRef = useRef<string | null>(null);
  const uploadQueue = useRef<{ key: string; file: File; folderId: string | null; meta?: Meta; tags?: string[] }[]>([]);
  const uploading = useRef(false);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const booksRef = useRef<Book[] | null>(null);
  /** The signed-in user's id, to skip notifications about their own actions. */
  const meIdRef = useRef(userId);
  meIdRef.current = userId;
  booksRef.current = books;

  // Keep the localStorage snapshot in step with every change (network refresh, live events,
  // optimistic edits), so the next cold start hydrates from the latest known state. `books`
  // changes on every reading position (this device's own too), so the snapshot is written at
  // most every 2 s, and right away when the page is hidden or closed and on sign-out.
  const snapshot = useRef<{ userId: string; books: Book[] } | null>(null);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveSnapshot = useCallback(() => {
    clearTimeout(snapshotTimer.current);
    snapshotTimer.current = undefined;
    if (snapshot.current) saveCachedBooks(snapshot.current.userId, snapshot.current.books);
    snapshot.current = null;
  }, []);
  useEffect(() => {
    if (!books) return;
    if (snapshot.current && snapshot.current.userId !== userId) saveSnapshot();
    snapshot.current = { userId, books };
    snapshotTimer.current ??= setTimeout(saveSnapshot, 2000);
  }, [books, userId, saveSnapshot]);
  useEffect(() => {
    const onHidden = () => document.visibilityState === "hidden" && saveSnapshot();
    window.addEventListener("pagehide", saveSnapshot);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", saveSnapshot);
      document.removeEventListener("visibilitychange", onHidden);
      saveSnapshot();
    };
  }, [saveSnapshot]);
  useEffect(() => {
    if (me) saveCachedMe(userId, me);
  }, [me, userId]);

  const log = useCallback((text: string, bookId?: string) => {
    setActivity((a) => [{ id: `${Date.now()}-${Math.random()}`, text, at: Date.now(), bookId }, ...a].slice(0, 30));
  }, []);

  const loadMe = useCallback(() => {
    getMe()
      .then(setMe)
      .catch(() => {});
  }, []);
  const meTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshMe = useCallback(() => {
    clearTimeout(meTimer.current);
    meTimer.current = setTimeout(loadMe, ME_DEBOUNCE);
  }, [loadMe]);
  useEffect(() => () => clearTimeout(meTimer.current), []);

  /** When the books list last loaded from the server. */
  const refreshedAt = useRef(0);
  const refresh = useCallback(() => {
    listBooks()
      .then((b) => {
        refreshedAt.current = Date.now();
        setBooks(sortBooks(b));
      })
      .catch(() => setBooks((prev) => prev ?? []));
    listFolders()
      .then((f) => setFolders(f.sort(byName)))
      .catch(() => {})
      .finally(() => setFoldersReady(true));
  }, []);

  // The public catalog says which books are the viewer's own: the next account gets its own.
  useEffect(() => forgetPublicBooks, [userId]);

  useEffect(() => {
    refresh();
    loadMe();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (eventsConnected() && Date.now() - refreshedAt.current < FRESH_FOR) return;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const off = onServerEvent((event, data) => {
      if (event === "book.created" || event === "book.deleted") {
        // Storage use changes whenever a book is added or removed (from any device), and so
        // does which public books are the viewer's own.
        refreshMe();
        forgetPublicBooks();
      }
      switch (event) {
        case RECONNECTED:
          // Events sent while disconnected were missed: reload everything they would have updated.
          refresh();
          refreshMe();
          forgetPublicBooks();
          setPublicVersion((v) => v + 1);
          setRequestsVersion((v) => v + 1);
          setClubsVersion((v) => v + 1);
          return;
        case "public.changed":
          forgetPublicBooks();
          setPublicVersion((v) => v + 1);
          return;
        case "requests.changed":
          setRequestsVersion((v) => v + 1);
          return;
        case "request.fulfilled":
          log(`Your request “${data.title}” was answered: it is in the Public Library now`);
          setRequestsVersion((v) => v + 1);
          return;
        case "club.message":
          if (data.author && data.fromId !== meIdRef.current) log(`${data.author} wrote in “${data.clubName}”`);
          setClubsVersion((v) => v + 1);
          return;
        case "club.progress":
        case "club.member":
        case "club.deleted":
          setClubsVersion((v) => v + 1);
          return;
        case "admin.report":
          log(`New report about “${data.title}” is waiting in the admin panel`);
          return;
        case "folder.created":
        case "folder.updated":
          setFolders((prev) => [...prev.filter((f) => f.id !== data.id), data as Folder].sort(byName));
          return;
        case "folder.deleted":
          setFolders((prev) => prev.filter((f) => f.id !== data.id));
          setBooks((prev) => prev?.map((b) => (b.folderId === data.id ? { ...b, folderId: null } : b)) ?? prev);
          return;
        case "book.created":
          // Books uploaded from this device are already in the list; anything else came from elsewhere.
          if (!booksRef.current?.some((b) => b.id === data.id)) log(`“${data.title}” was added to your library`, data.id);
          setBooks((prev) => (!prev || prev.some((b) => b.id === data.id) ? prev : sortBooks([data as Book, ...prev])));
          return;
        case "book.updated":
          setBooks((prev) => prev?.map((b) => (b.id === data.id ? (data as Book) : b)) ?? prev);
          return;
        case "book.deleted":
          setBooks((prev) => prev?.filter((b) => b.id !== data.id) ?? prev);
          return;
        case "progress.updated": {
          const p = data as Progress;
          if (p.deviceId && p.deviceId !== deviceId) {
            const title = booksRef.current?.find((b) => b.id === p.bookId)?.title;
            if (title) log(`Reached ${percent(p.percentage)} of “${title}” on ${p.deviceName ?? "another device"}`, p.bookId);
          }
          setBooks((prev) => (prev ? sortBooks(prev.map((b) => (b.id === p.bookId ? { ...b, progress: p } : b))) : prev));
          return;
        }
      }
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshMe, loadMe, log]);

  // Progress updates wait and are applied together, once every PROGRESS_INTERVAL; any other
  // change (a new state: processing, done, failed…) applies at once, after the waiting ones.
  const pendingPatches = useRef(new Map<string, Partial<UploadItem>>());
  const patchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushPatches = useCallback(() => {
    clearTimeout(patchTimer.current);
    patchTimer.current = undefined;
    const pending = pendingPatches.current;
    if (!pending.size) return;
    const patches = new Map(pending);
    pending.clear();
    setUploads((u) => u.map((x) => (patches.has(x.key) ? { ...x, ...patches.get(x.key) } : x)));
  }, []);
  useEffect(
    () => () => {
      clearTimeout(patchTimer.current);
      patchTimer.current = undefined;
    },
    [],
  );

  const patchUpload = useCallback(
    (key: string, patch: Partial<UploadItem>) => {
      pendingPatches.current.set(key, { ...pendingPatches.current.get(key), ...patch });
      flushPatches();
    },
    [flushPatches],
  );

  const patchUploadProgress = useCallback(
    (key: string, patch: Partial<UploadItem>) => {
      pendingPatches.current.set(key, { ...pendingPatches.current.get(key), ...patch });
      patchTimer.current ??= setTimeout(flushPatches, PROGRESS_INTERVAL);
    },
    [flushPatches],
  );

  /** Sends queued files one at a time; files dropped meanwhile join the same queue. */
  const runUploads = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      for (let job = uploadQueue.current.shift(); job; job = uploadQueue.current.shift()) {
        const { key, file, folderId, meta, tags } = job;
        const result = await uploadBook(file, {
          folderId,
          meta,
          onPreparing: () => patchUpload(key, { status: "preparing" }),
          // At 100% the server still stores the file and reads its metadata.
          onProgress: (progress) =>
            progress >= 1 ? patchUpload(key, { status: "processing", progress }) : patchUploadProgress(key, { status: "uploading", progress }),
        });
        if (result.ok) {
          let book = result.book;
          if (tags?.length) book = await updateBook(book.id, { tags }).catch(() => book);
          patchUpload(key, { status: "done", progress: 1, bookId: book.id });
          forgetPublicBooks();
          log(`Uploaded “${book.title}”`, book.id);
          setBooks((prev) => (prev?.some((b) => b.id === book.id) ? prev : sortBooks([book, ...(prev ?? [])])));
        } else if (result.error === "duplicate" && result.bookId) {
          // Dropped on a collection: the copy already in the library moves there.
          let message = "Already in your library";
          if (folderId) {
            try {
              const moved = await updateBook(result.bookId, { folderId });
              setBooks((prev) => prev?.map((b) => (b.id === moved.id ? moved : b)) ?? prev);
              message = "Already in your library, moved to this collection";
            } catch {
              /* keep the plain message */
            }
          }
          patchUpload(key, { status: "duplicate", progress: 1, bookId: result.bookId, message });
        } else {
          const quota = meRef.current?.quotaBytes;
          patchUpload(key, {
            status: "error",
            message: result.error === "quota_exceeded" && quota ? `Storage limit reached (${fileSize(quota)})` : (UPLOAD_ERRORS[result.error] ?? result.error),
          });
        }
      }
    } finally {
      uploading.current = false;
      refreshMe();
    }
  }, [log, patchUpload, patchUploadProgress, refreshMe]);

  const upload = useCallback(
    (files: FileList | (File | UploadEntry)[], folderId: string | null = null) => {
      const items: UploadItem[] = Array.from(files as ArrayLike<File | UploadEntry>).map((entry, i) => {
        const { file, meta, tags } = entry instanceof File ? { file: entry, meta: undefined, tags: undefined } : entry;
        const key = `${file.name}-${file.size}-${Date.now()}-${i}`;
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          return { key, name: file.name, size: file.size, status: "error", progress: 0, message: "Unsupported file type", folderId };
        }
        uploadQueue.current.push({ key, file, folderId, meta, tags });
        return { key, name: file.name, size: file.size, status: "queued", progress: 0, folderId };
      });
      setUploads((u) => [...u, ...items]);
      void runUploads();
    },
    [runUploads],
  );

  const clearUploads = useCallback(() => setUploads((u) => u.filter(isActiveUpload)), []);

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

  const removeBook = useCallback(async (book: Book) => {
    if (!window.confirm(`Delete "${book.title}" from your library on all devices?`)) return;
    await deleteBook(book.id);
    await forgetCachedBook(book.id);
    forgetPublicBooks();
    setBooks((prev) => prev?.filter((b) => b.id !== book.id) ?? prev);
    refreshMe();
  }, [refreshMe]);

  const replaceBook = useCallback((book: Book) => {
    setBooks((prev) => prev?.map((b) => (b.id === book.id ? book : b)) ?? prev);
  }, []);

  const toggleFavorite = useCallback(
    async (book: Book) => {
      const favorite = !book.favorite;
      replaceBook({ ...book, favorite });
      try {
        replaceBook(await updateBook(book.id, { favorite }));
      } catch {
        replaceBook(book);
      }
    },
    [replaceBook],
  );

  const addFolder = useCallback(async (given?: string) => {
    const name = (given ?? window.prompt("Collection name"))?.trim();
    if (!name) return null;
    if (given) {
      const existing = foldersRef.current.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
    }
    try {
      const folder = await createFolder(name);
      setFolders((prev) => [...prev.filter((f) => f.id !== folder.id), folder].sort(byName));
      return folder;
    } catch (err) {
      window.alert(err instanceof ApiError && err.status === 409 ? "A collection with this name already exists." : "Could not create the collection.");
      return null;
    }
  }, []);

  const renameFolderPrompt = useCallback(async (folder: Folder) => {
    const name = window.prompt("Rename collection", folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      const updated = await renameFolder(folder.id, name);
      setFolders((prev) => prev.map((f) => (f.id === updated.id ? updated : f)).sort(byName));
    } catch (err) {
      window.alert(err instanceof ApiError && err.status === 409 ? "A collection with this name already exists." : "Could not rename the collection.");
    }
  }, []);

  const removeFolder = useCallback(async (folder: Folder) => {
    if (!window.confirm(`Delete the collection "${folder.name}"? Its books stay in your library.`)) return false;
    await deleteFolder(folder.id);
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setBooks((prev) => prev?.map((b) => (b.folderId === folder.id ? { ...b, folderId: null } : b)) ?? prev);
    return true;
  }, []);

  const markActivityRead = useCallback(() => setReadAt(Date.now()), []);
  const pickFiles = useCallback((folderId?: string | null) => {
    pickFolderRef.current = folderId ?? null;
    inputRef.current?.click();
  }, []);
  const getBook = useCallback((id: string) => booksRef.current?.find((b) => b.id === id), []);

  const actions = useMemo<LibraryActions>(
    () => ({
      refreshMe,
      markActivityRead,
      setQuery,
      pickFiles,
      upload,
      removeBook,
      toggleFavorite,
      replaceBook,
      getBook,
      addFolder,
      renameFolderPrompt,
      removeFolder,
      openShare: setSharing,
      openOrganize: setOrganizing,
    }),
    [refreshMe, markActivityRead, pickFiles, upload, removeBook, toggleFavorite, replaceBook, getBook, addFolder, renameFolderPrompt, removeFolder],
  );

  const unreadActivity = useMemo(() => activity.filter((a) => a.at > readAt).length, [activity, readAt]);
  const value = useMemo<LibraryCtx>(
    () => ({
      ...actions,
      books,
      folders,
      me,
      publicVersion,
      requestsVersion,
      clubsVersion,
      foldersReady,
      activity,
      unreadActivity,
      query,
      sharing,
      organizing,
    }),
    [actions, books, folders, me, publicVersion, requestsVersion, clubsVersion, foldersReady, activity, unreadActivity, query, sharing, organizing],
  );

  const uploadsValue = useMemo<UploadsCtx>(() => ({ uploads, clearUploads }), [uploads, clearUploads]);

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
          if (e.target.files) upload(e.target.files, pickFolderRef.current);
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
