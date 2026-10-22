import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Book } from "../lib/api";
import { inkSignature, type InkChange } from "../lib/ink";
import { createInkSession, EMPTY_INK, type InkSession } from "../lib/inkSession";
import type { ReaderHandle } from "./types";

/**
 * PDF handwriting of the open book (lib/inkSession), kept in sync with other devices; changes
 * work offline. Strokes load around `page`, the page being read.
 */
export function useInkSession(book: Book | null, page: number, reader: RefObject<ReaderHandle | null>) {
  const bookId = book?.format === "pdf" ? book.id : null;
  const [session, setSession] = useState<InkSession | null>(null);
  /** Notebook pictures of annotated pages: the latest one of each page, with the strokes it shows. */
  const thumbs = useRef(new Map<number, { signature: string; url: string }>());

  useEffect(() => {
    thumbs.current.clear(); // another book's pictures
    if (!bookId) return;
    const s = createInkSession(bookId, {
      onRejected: (p, status) =>
        window.alert(
          status === 413
            ? `Page ${p} has too much handwriting to save. The last strokes were not kept; erase some strokes to make room.`
            : `Some handwriting on page ${p} could not be saved.`,
        ),
    });
    setSession(s);
    return () => {
      s.close();
      setSession(null);
    };
  }, [bookId]);

  const subscribe = useCallback((onChange: () => void) => session?.subscribe(onChange) ?? (() => {}), [session]);
  const snapshot = useSyncExternalStore(subscribe, () => session?.snapshot() ?? EMPTY_INK);

  useEffect(() => {
    if (session && page) session.showAround(page);
  }, [session, page]);

  /** A notebook picture: loads the page (and the next annotated ones, in the same request), kept for reuse. */
  const thumbnail = useCallback(
    async (p: number) => {
      if (!session) return null;
      const after = session.snapshot().annotated.filter((a) => a.page > p).slice(0, 7).map((a) => a.page);
      await session.load([p, ...after]);
      const strokes = session.snapshot().pages[p] ?? [];
      const signature = inkSignature(strokes);
      const hit = thumbs.current.get(p);
      if (hit?.signature === signature) return hit.url;
      const url = (await reader.current?.thumbnail?.(p, 240, strokes)) ?? null;
      if (url) thumbs.current.set(p, { signature, url });
      return url;
    },
    [session, reader],
  );

  const draw = useCallback((p: number, change: InkChange) => session?.draw(p, change), [session]);
  const undo = useCallback(() => session?.undo() ?? null, [session]);
  const redo = useCallback(() => session?.redo() ?? null, [session]);

  return { ...snapshot, draw, undo, redo, thumbnail };
}
