export type BookFormat = "pdf" | "epub" | "mobi" | "azw3" | "fb2" | "cbz" | "cbr" | "cb7" | "cbt";

export const MIME_TYPES: Record<BookFormat, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  fb2: "application/x-fictionbook+xml",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  cb7: "application/x-cb7",
  cbt: "application/x-cbt",
};

/** Bytes of the file the detector needs (TAR's magic sits at offset 257). */
export const DETECT_BYTES = 512;

/**
 * Detects the real format from the file's first bytes (never trusts the extension alone).
 * The extension is only used to tell apart formats that share a container (zip, PalmDB).
 */
export function detectFormat(head: Buffer, filename: string): BookFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const ascii = head.toString("latin1");

  if (ascii.startsWith("%PDF-")) return "pdf";

  // ZIP container: EPUB stores "mimetype" uncompressed as the first entry.
  if (head.length >= 4 && head.readUInt32LE(0) === 0x04034b50) {
    if (ascii.slice(30, 58) === "mimetypeapplication/epub+zip") return "epub";
    if (ext === "epub") return "epub";
    if (ext === "cbz") return "cbz";
    return null;
  }

  // Comic archives in other containers. Plain .rar/.7z/.tar files are accepted too, as
  // comics: the reader rejects archives without images when they are opened.
  if (ascii.startsWith("Rar!\x1a\x07")) return ext === "cbr" || ext === "rar" ? "cbr" : null;
  if (head.length >= 6 && head.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])))
    return ext === "cb7" || ext === "7z" ? "cb7" : null;
  if (ascii.slice(257, 262) === "ustar") return ext === "cbt" || ext === "tar" ? "cbt" : null;

  // PalmDB header: type+creator at offset 60 is "BOOKMOBI" for MOBI / KF8 (AZW3).
  if (ascii.slice(60, 68) === "BOOKMOBI") return ext === "azw3" || ext === "azw" ? "azw3" : "mobi";

  if (ext === "fb2" && /^(﻿)?\s*<\?xml|^\s*<FictionBook/i.test(ascii)) return "fb2";

  return null;
}
