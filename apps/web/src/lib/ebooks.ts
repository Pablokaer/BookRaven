import type { Book } from "./api";
import { downloadBook, openBookFile } from "./books";
import { lazyBlob } from "./rangeFile";
import { openRangeZip } from "./rangeZip";

/**
 * The foliate-js book for an ebook, read by ranges: an EPUB downloads its directory and
 * the chapters (and their images) as they are shown; a MOBI/AZW3 the records it reads.
 * FB2 is a single XML file, so it is downloaded whole.
 */
export async function openEbook(book: Book): Promise<File | object> {
  if (book.format === "epub") {
    const file = await openBookFile(book);
    const [{ zip, entries }, { EPUB }] = await Promise.all([openRangeZip(file), import("foliate-js/epub.js")]);
    const byName = new Map(entries.map((e) => [e.filename, e]));
    // The same loader foliate-js builds for a local file (view.js makeZipLoader).
    return new EPUB({
      entries,
      loadText: (name: string) => byName.get(name)?.getData(new zip.TextWriter()) ?? null,
      loadBlob: (name: string, type?: string) => byName.get(name)?.getData(new zip.BlobWriter(type)) ?? null,
      getSize: (name: string) => byName.get(name)?.uncompressedSize ?? 0,
    }).init();
  }
  if (book.format === "mobi" || book.format === "azw3") {
    const file = await openBookFile(book);
    const [{ MOBI }, fflate] = await Promise.all([import("foliate-js/mobi.js"), import("foliate-js/vendor/fflate.js")]);
    return new MOBI({ unzlib: fflate.unzlibSync }).open(lazyBlob(file, book.filename));
  }
  return downloadBook(book);
}
