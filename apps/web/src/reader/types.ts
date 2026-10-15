import type { TocItem } from "foliate-js/view.js";
import type { Book, Highlight } from "../lib/api";
import type { InkChange, InkPages, InkTool, Stroke } from "../lib/ink";
import type { Position } from "../lib/progress";
import type { ReaderSettings } from "../lib/settings";

export type TapZone = "left" | "center" | "right";

export type ReaderHandle = {
  /** User navigation (counts as reading activity and is saved). */
  next(): void;
  prev(): void;
  goToFraction(fraction: number): void;
  goToHref?(href: string): void;
  /** Programmatic jump (e.g. adopting another device's position): not saved by itself. */
  restore(locator: string): void;
  /** Drops the current text selection in the book. */
  clearSelection?(): void;
  /** Full-text search; calls `onResult` as matches are found, resolves when done. */
  search?(query: string, onResult: (r: SearchResult) => void, signal: AbortSignal): Promise<void>;
  /** Removes search marks from the pages. */
  clearSearch?(): void;
  /** PDFs: zoom in or out a step, or back to the fitted page. */
  zoom?(action: "in" | "out" | "reset"): void;
  /** PDFs: a small picture of a page with its handwriting (`strokes`, else the page's in `ink`), as a data URL. */
  thumbnail?(page: number, width: number, strokes?: Stroke[]): Promise<string | null>;
};

/** PDFs: what the pen does while annotating. */
export type InkMode = {
  tool: InkTool | "eraser";
  color: string;
  /** Fraction of the page width. */
  width: number;
  /** Fingers draw too (otherwise they scroll, zoom and turn pages, and only a pen or mouse draws). */
  fingerDraws: boolean;
};

/** One search match: `locator` is passed back to goToHref to show it. */
export type SearchResult = { locator: string; label: string; excerpt: { pre: string; match: string; post: string } };

/** Text the reader selected, with its on-screen box (viewport coordinates). */
export type TextSelection = { cfi: string; text: string; rect: DOMRect };

export type ReaderProps = {
  book: Book;
  initialLocator: string | null;
  settings: ReaderSettings;
  /** `byUser` is false for the initial position, layout changes and restores. */
  onRelocate(pos: Position, byUser: boolean): void;
  onTap(zone: TapZone): void;
  onKeyDown(e: KeyboardEvent): void;
  onReady(info: { toc?: TocItem[]; totalPages?: number; language?: string | null }): void;
  onError(message: string): void;
  /** Text books and PDFs (not comics). */
  highlights?: Highlight[];
  /** Comics: the magnifying glass is on (taps and swipes then move the lens instead of turning pages). */
  magnifier?: boolean;
  onSelection?(selection: TextSelection | null): void;
  onHighlightClick?(highlight: Highlight, rect: DOMRect): void;
  /** PDFs: the zoom level changed (1 = the fitted page). */
  onZoom?(zoom: number): void;
  /** PDFs: handwritten strokes of each page. */
  ink?: InkPages;
  /** PDFs: annotating with the pen (null: reading). */
  inkMode?: InkMode | null;
  /** PDFs: strokes were drawn or erased on `page`. */
  onInkChange?(page: number, change: InkChange): void;
};

export function zoneFromX(x: number, width: number): TapZone {
  const r = x / width;
  if (r < 0.3) return "left";
  if (r > 0.7) return "right";
  return "center";
}

/** Time window after an interaction in which a relocation counts as user navigation. */
export const USER_NAV_WINDOW_MS = 2000;
