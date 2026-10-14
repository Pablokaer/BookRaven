// Minimal typings for the parts of foliate-js we use (the library ships plain JS).
declare module "foliate-js/view.js" {
  export type TocItem = { label: string; href: string; subitems?: TocItem[] };
  export type FoliateBook = {
    metadata?: { title?: unknown; author?: unknown; language?: unknown; description?: unknown };
    toc?: TocItem[];
    dir?: string;
    getCover?: () => Promise<Blob | null>;
    destroy?: () => void;
  };
  export type RelocateDetail = {
    cfi: string;
    fraction: number;
    location?: { current: number; next: number; total: number };
    tocItem?: { label?: string; href?: string };
    pageItem?: { label?: string };
  };
  export interface FoliateView extends HTMLElement {
    book: FoliateBook;
    renderer: HTMLElement & {
      setStyles?: (css: string | [string, string]) => void;
      next: () => Promise<void>;
      prev: () => Promise<void>;
      getContents?: () => { doc: Document; index: number }[];
    };
    lastLocation?: RelocateDetail;
    /** A file, a URL, or a ready-made book object (e.g. a comic built by lib/comics.ts). */
    open(file: File | Blob | string | object): Promise<void>;
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<void>;
    goToFraction(frac: number): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    close(): void;
    addAnnotation(annotation: { value: string }): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    getCFI(index: number, range: Range): string;
    /** Yields per-section results ({ label, subitems }), progress objects, then "done". */
    search(opts: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean }): AsyncGenerator<
      | "done"
      | { progress: number }
      | { label: string; subitems: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] }
      | { cfi: string; excerpt: { pre: string; match: string; post: string } }
    >;
    clearSearch(): void;
  }
  export function makeBook(file: File | string): Promise<FoliateBook>;
}

declare module "foliate-js/overlayer.js" {
  type Rect = { left: number; top: number; width: number; height: number };
  export class Overlayer {
    static highlight(rects: Rect[], options?: { color?: string; padding?: number }): SVGElement;
    static underline(rects: Rect[], options?: { color?: string; width?: number }): SVGElement;
  }
}

declare module "foliate-js/epubcfi.js" {
  export function compare(a: string, b: string): number;
}

declare module "foliate-js/vendor/zip.js" {
  export type ZipEntry = {
    filename: string;
    directory: boolean;
    uncompressedSize: number;
    getData<T>(writer: { __type?: T }): Promise<T>;
  };
  export function configure(opts: { useWebWorkers: boolean }): void;
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class BlobWriter {
    __type?: Blob;
    constructor(mime?: string);
  }
  export class TextWriter {
    __type?: string;
  }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<ZipEntry[]>;
  }
}
