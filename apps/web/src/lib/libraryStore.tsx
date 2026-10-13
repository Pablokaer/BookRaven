import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, type Book, type Folder, type Me, type Progress } from "./api";
import { deleteBook, forgetCachedBook, listBooks, SUPPORTED_EXTENSIONS, uploadBook } from "./books";
import { deviceId } from "./device";
import { onServerEvent } from "./events";
import { percent } from "./format";
import { fileSize } from "./format";
import { createFolder, deleteFolder, listFolders, renameFolder, updateBook } from "./library";
import { getMe } from "./publicLibrary";

export type UploadItem = { key: string; name: string; status: "uploading" | "done" | "error"; message?: string };

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
  const t = (b: Book) => new Date(b.progress?.updatedAt ?? b.createdAt).getTime();
  return [...books].sort((a, b) => t(b) - t(a));
}

type LibraryCtx = {
  books: Book[] | null;
  folders: Folder[];
  /** Role and storage use of the signed-in account (null until loaded). */
  me: Me | null;
  refreshMe: () => void;
  /** Bumped whenever the public library changes anywhere, so its page can reload. */
  publicVersion: number;
  /** False until the collections list has loaded once. */
  foldersReady: boolean;
  uploads: UploadItem[];
  activity: Activity[];
  unreadActivity: number;
  markActivityRead: () => void;
  /** Global search from the top bar. */
  query: string;
  setQuery: (q: string) => void;

  pickFiles: () => void;
  upload: (files: FileList | File[]) => Promise<void>;
  removeBook: (book: Book) => Promise<void>;
  toggleFavorite: (book: Book) => Promise<void>;
  replaceBook: (book: Book) => void;

  addFolder: () => Promise<Folder | null>;
  renameFolderPrompt: (folder: Folder) => Promise<void>;
  removeFolder: (folder: Folder) => Promise<boolean>;

  /** Dialogs hosted by the app shell. */
  sharing: Book | null;
  organizing: Book | null;
  openShare: (book: Book | null) => void;
  openOrganize: (book: Book | null) => void;
};

const Ctx = createContext<LibraryCtx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersReady, setFoldersReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [publicVersion, setPublicVersion] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [readAt, setReadAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [sharing, setSharing] = useState<Book | null>(null);
  const [organizing, setOrganizing] = useState<Book | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const booksRef = useRef<Book[] | null>(null);
  booksRef.current = books;

  const log = useCallback((text: string, bookId?: string) => {
    setActivity((a) => [{ id: `${Date.now()}-${Math.random()}`, text, at: Date.now(), bookId }, ...a].slice(0, 30));
  }, []);

  const refreshMe = useCallback(() => {
    getMe()
      .then(setMe)
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    listBooks()
      .then((b) => setBooks(sortBooks(b)))
      .catch(() => setBooks((prev) => prev ?? []));
    listFolders()
      .then((f) => setFolders(f.sort(byName)))
      .catch(() => {})
      .finally(() => setFoldersReady(true));
  }, []);

  useEffect(() => {
    refresh();
    refreshMe();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    const off = onServerEvent((event, data) => {
      // Storage use changes whenever a book is added or removed (from any device).
      if (event === "book.created" || event === "book.deleted") refreshMe();
      switch (event) {
        case "public.changed":
          setPublicVersion((v) => v + 1);
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
  }, [refresh, refreshMe, log]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${Date.now()}`;
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          setUploads((u) => [...u, { key, name: file.name, status: "error", message: "Unsupported file type" }]);
          continue;
        }
        setUploads((u) => [...u, { key, name: file.name, status: "uploading" }]);
        const result = await uploadBook(file);
        setUploads((u) =>
          u.map((x) =>
            x.key === key
              ? result.ok
                ? { ...x, status: "done" }
                : {
                  ...x,
                  status: "error",
                  message:
                    result.error === "quota_exceeded" && me?.quotaBytes
                      ? `Storage limit reached (${fileSize(me.quotaBytes)})`
                      : (UPLOAD_ERRORS[result.error] ?? result.error),
                }
              : x,
          ),
        );
        if (result.ok) {
          log(`Uploaded “${result.book.title}”`, result.book.id);
          setBooks((prev) => (prev?.some((b) => b.id === result.book.id) ? prev : sortBooks([result.book, ...(prev ?? [])])));
        }
      }
      refreshMe();
      setTimeout(() => setUploads((u) => u.filter((x) => x.status === "uploading")), 6000);
    },
    [log, me, refreshMe],
  );

  const removeBook = useCallback(async (book: Book) => {
    if (!window.confirm(`Delete "${book.title}" from your library on all devices?`)) return;
    await deleteBook(book.id);
    await forgetCachedBook(book.id);
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

  const addFolder = useCallback(async () => {
    const name = window.prompt("Collection name")?.trim();
    if (!name) return null;
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

  const value = useMemo<LibraryCtx>(
    () => ({
      books,
      folders,
      me,
      refreshMe,
      publicVersion,
      foldersReady,
      uploads,
      activity,
      unreadActivity: activity.filter((a) => a.at > readAt).length,
      markActivityRead: () => setReadAt(Date.now()),
      query,
      setQuery,
      pickFiles: () => inputRef.current?.click(),
      upload,
      removeBook,
      toggleFavorite,
      replaceBook,
      addFolder,
      renameFolderPrompt,
      removeFolder,
      sharing,
      organizing,
      openShare: setSharing,
      openOrganize: setOrganizing,
    }),
    [books, folders, me, refreshMe, publicVersion, foldersReady, uploads, activity, readAt, query, upload, removeBook, toggleFavorite, replaceBook, addFolder, renameFolderPrompt, removeFolder, sharing, organizing],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={SUPPORTED_EXTENSIONS.join(",")}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </Ctx.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLibrary outside LibraryProvider");
  return ctx;
}

/** Books matching the top-bar search: title, author, tags or collection name. */
export function matchesQuery(book: Book, query: string, folders: Folder[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const folder = book.folderId ? folders.find((f) => f.id === book.folderId)?.name ?? "" : "";
  return `${book.title} ${book.author ?? ""} ${book.tags.join(" ")} ${folder}`.toLowerCase().includes(q);
}
