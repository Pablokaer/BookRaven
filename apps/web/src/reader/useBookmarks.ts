import { useEffect, useMemo, useState } from "react";
import type { Book, Bookmark } from "../lib/api";
import { bookmarkLocator, pageMatcher, type BookKind } from "../lib/bookmarkPages";
import { deleteBookmark, loadBookmarks, putBookmark, rememberBookmarks, sortBookmarks } from "../lib/bookmarks";
import { isComicFormat } from "../lib/comicFormats";
import { onServerEvent } from "../lib/events";
import type { Position } from "../lib/progress";

/**
 * A book's bookmarks (every format), kept in sync with other devices; changes work offline
 * (lib/bookmarks). `pageBookmark` is the one on the page at `position`, if any.
 */
export function useBookmarks(book: Book | null, position: Position | null) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** The book whose bookmarks are loaded (null while loading). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    setLoadedFor(null);
    const load = () =>
      loadBookmarks(book.id)
        .then((list) => {
          if (cancelled) return;
          setBookmarks(list);
          setLoadedFor(book.id);
        })
        .catch(() => {});
    void load();
    const off = onServerEvent((event, data) => {
      if (event === "bookmark.saved" && data.bookId === book.id) {
        setBookmarks((prev) => sortBookmarks([...prev.filter((b) => b.locator !== data.locator), data]));
      } else if (event === "bookmark.deleted" && data.bookId === book.id) {
        setBookmarks((prev) => prev.filter((b) => b.locator !== data.locator));
      }
    });
    const onRejected = (e: Event) => {
      const { bookId, status } = (e as CustomEvent<{ bookId: string; status: number }>).detail;
      if (bookId !== book.id) return;
      if (status === 409) window.alert("This book has too many bookmarks; remove some to add more.");
      void load(); // show what the server kept
    };
    window.addEventListener("readsync:bookmarks-rejected", onRejected);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener("readsync:bookmarks-rejected", onRejected);
    };
  }, [book]);

  // Keep the offline copy current, once the list is loaded (before that it is just empty).
  useEffect(() => {
    if (book && loadedFor === book.id) rememberBookmarks(book.id, bookmarks);
  }, [book, bookmarks, loadedFor]);

  const kind: BookKind = book?.format === "pdf" ? "pdf" : book && isComicFormat(book.format) ? "comic" : "text";
  const locator = position?.locator;
  const pageBookmark = useMemo(() => {
    if (locator === undefined) return undefined;
    const onPage = pageMatcher(locator, kind);
    return bookmarks.find((b) => onPage(b.locator));
  }, [bookmarks, locator, kind]);

  const removeBookmark = (b: Bookmark) => {
    if (!book) return;
    setBookmarks((prev) => prev.filter((x) => x.locator !== b.locator));
    deleteBookmark(book.id, b.locator);
  };

  const toggleBookmark = () => {
    if (!book || !position) return;
    if (pageBookmark) return removeBookmark(pageBookmark);
    const b = { locator: bookmarkLocator(position.locator, kind), percentage: position.percentage, label: position.label };
    putBookmark(book.id, b);
    setBookmarks((prev) =>
      sortBookmarks([
        ...prev.filter((x) => x.locator !== b.locator),
        { ...b, id: `local:${b.locator}`, bookId: book.id, title: null, createdAt: new Date().toISOString() },
      ]),
    );
  };

  const renameBookmark = (b: Bookmark, title: string | null) => {
    if (!book || title === b.title) return;
    setBookmarks((prev) => prev.map((x) => (x.locator === b.locator ? { ...x, title } : x)));
    putBookmark(book.id, { locator: b.locator, percentage: b.percentage, label: b.label, title });
  };

  return { bookmarks, pageBookmark, toggleBookmark, renameBookmark, removeBookmark };
}
