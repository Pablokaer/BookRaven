import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { TtlCache } from "./cache.js";
import { imageMime } from "./formats.js";
import { coverKey, readObject } from "./storage.js";

/**
 * Small grayscale cover thumbnails for e-ink readers (the OPDS catalog): a stored cover is up to
 * 600 px wide and in colour, which an e-reader downloads for every book of a list only to scale
 * it down and drop the colour. Made on first request in plain JavaScript (JPEG and PNG covers,
 * which are what uploads and imports store) and kept in memory: a thumbnail is a few KB.
 */

/** Width of a thumbnail; narrower covers keep their width. */
export const THUMB_WIDTH = 200;
const QUALITY = 80;
/** Covers are at most 5 MB (see MAX_COVER_BYTES): anything decoding to more is not a cover. */
const MAX_PIXELS_MP = 40;

const thumbs = new TtlCache<Buffer | null>(1000);
const DAY = 24 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<Buffer | null>>();

async function readCover(bookId: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of await readObject(coverKey(bookId))) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** RGBA pixels of a JPEG or PNG, or null for other types (WebP, GIF) and unreadable images. */
function decode(image: Buffer): { width: number; height: number; data: Uint8Array } | null {
  try {
    const type = imageMime(image);
    if (type === "image/jpeg") return jpeg.decode(image, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS_MP, maxMemoryUsageInMB: 256 });
    if (type === "image/png") {
      const png = PNG.sync.read(image);
      return png.width * png.height > MAX_PIXELS_MP * 1e6 ? null : png;
    }
  } catch {
    /* damaged cover: no thumbnail */
  }
  return null;
}

/**
 * Scales an RGBA image down to `THUMB_WIDTH` in shades of gray (each thumbnail pixel is the
 * average of the source pixels it covers; transparency on white, as on paper).
 */
export function grayThumbnail(img: { width: number; height: number; data: Uint8Array }) {
  const scale = Math.min(1, THUMB_WIDTH / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) / scale)));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3]! / 255;
          const luma = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
          sum += luma * a + 255 * (1 - a);
        }
      }
      const v = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      const o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return jpeg.encode({ width: w, height: h, data: out }, QUALITY).data;
}

/**
 * The JPEG thumbnail of a book's cover, or null when its cover can't be made into one (the full
 * cover is served then). A book's cover never changes, so neither does its thumbnail.
 */
export function coverThumbnail(bookId: string): Promise<Buffer | null> {
  const known = thumbs.get(bookId);
  if (known !== undefined) return Promise.resolve(known);
  const running = inflight.get(bookId);
  if (running) return running;
  const job = (async () => {
    const img = decode(await readCover(bookId));
    const thumb = img ? grayThumbnail(img) : null;
    thumbs.set(bookId, thumb, DAY);
    return thumb;
  })().finally(() => inflight.delete(bookId));
  inflight.set(bookId, job);
  return job;
}
