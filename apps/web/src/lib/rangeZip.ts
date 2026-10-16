import type { RangeFile } from "./rangeFile";

/**
 * Lists a ZIP (EPUB, CBZ) read by ranges: only its directory, at the end of the file, is
 * downloaded. Each entry's data (a chapter, a page image) is fetched when it is read.
 */
export async function openRangeZip(file: RangeFile) {
  const zip = await import("foliate-js/vendor/zip.js");
  zip.configure({ useWebWorkers: false });
  // zip.js reads through its Reader class (not exported): BlobReader is one, with our bytes.
  class RangeReader extends zip.BlobReader {
    constructor() {
      super(new Blob());
      this.size = file.size;
    }
    override readUint8Array(offset: number, length: number) {
      return file.read(offset, offset + length);
    }
  }
  const entries = await new zip.ZipReader(new RangeReader()).getEntries();
  return { zip, entries };
}

/** Where an entry's data starts in `head`, the bytes read from its local header on (whose length only that header tells). */
export function localDataStart(head: Uint8Array) {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return 30 + view.getUint16(26, true) + view.getUint16(28, true);
}
