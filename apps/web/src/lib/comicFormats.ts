/**
 * Comic book archives: ZIP, RAR, 7-Zip and TAR containers of page images. Only the format
 * names live here, for the library's pages; reading the archives (lib/comics) loads with the
 * reader, or when a comic is uploaded.
 */
export const COMIC_FORMATS = ["cbz", "cbr", "cb7", "cbt"] as const;
export type ComicFormat = (typeof COMIC_FORMATS)[number];

export const isComicFormat = (format: string): format is ComicFormat => (COMIC_FORMATS as readonly string[]).includes(format);

/** Guesses the format of a local file by extension (uploads, before the server checks it). */
export function comicFormatOfName(name: string): ComicFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, ComicFormat> = { cbz: "cbz", cbr: "cbr", rar: "cbr", cb7: "cb7", "7z": "cb7", cbt: "cbt", tar: "cbt" };
  return map[ext] ?? null;
}
