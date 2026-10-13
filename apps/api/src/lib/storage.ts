import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";

/**
 * File storage on local disk.
 * Book files are content-addressed by SHA-256 (books/ab/cd/<hash>), so identical
 * uploads share one file on disk. Covers are stored per book id.
 *
 * Everything goes through this module, so it can later be swapped for an
 * S3-compatible store (e.g. Garage) without touching the routes.
 */

const dirs = {
  tmp: path.join(config.storageDir, "tmp"),
  books: path.join(config.storageDir, "books"),
  covers: path.join(config.storageDir, "covers"),
};

export async function ensureStorageDirs() {
  await Promise.all(Object.values(dirs).map((d) => fs.mkdir(d, { recursive: true })));
}

export function bookFilePath(sha256: string) {
  return path.join(dirs.books, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

export function coverFilePath(bookId: string) {
  return path.join(dirs.covers, `${bookId}.img`);
}

export type TempFile = { tmpPath: string; sha256: string; size: number; head: Buffer };

/** Streams an upload to a temp file while computing its hash and keeping the first bytes. */
export async function streamToTemp(source: Readable, headBytes = 128): Promise<TempFile> {
  const tmpPath = path.join(dirs.tmp, randomUUID());
  const hash = createHash("sha256");
  let size = 0;
  const headChunks: Buffer[] = [];
  let headLen = 0;

  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      if (headLen < headBytes) {
        headChunks.push(chunk.subarray(0, headBytes - headLen));
        headLen += Math.min(chunk.length, headBytes - headLen);
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(source, tap, createWriteStream(tmpPath));
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
  return { tmpPath, sha256: hash.digest("hex"), size, head: Buffer.concat(headChunks) };
}

/** Moves a temp upload into its content-addressed location (no-op if it already exists). */
export async function commitBookFile(tmp: TempFile) {
  const dest = bookFilePath(tmp.sha256);
  try {
    await fs.access(dest);
    await fs.rm(tmp.tmpPath, { force: true });
  } catch {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tmp.tmpPath, dest);
  }
}

export async function commitCover(tmpPath: string, bookId: string) {
  await fs.rename(tmpPath, coverFilePath(bookId));
}

export async function removeTemp(tmpPath: string | undefined) {
  if (tmpPath) await fs.rm(tmpPath, { force: true });
}

export async function removeBookFile(sha256: string) {
  await fs.rm(bookFilePath(sha256), { force: true });
}

export async function removeCover(bookId: string) {
  await fs.rm(coverFilePath(bookId), { force: true });
}

export function openRange(filePath: string, start?: number, end?: number) {
  return createReadStream(filePath, start === undefined ? undefined : { start, end });
}

export async function copyCover(fromBookId: string, toBookId: string) {
  await fs.copyFile(coverFilePath(fromBookId), coverFilePath(toBookId));
}
