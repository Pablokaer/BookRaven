import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

/**
 * File storage. Book files are content-addressed by SHA-256 (books/ab/cd/<hash>), so
 * identical uploads share one object. Covers are stored per book id.
 *
 * Two drivers sit behind the same functions:
 * - "local": a folder on disk (STORAGE_DIR), the default;
 * - "s3": any S3-compatible object store (AWS, Garage, MinIO, R2...).
 * Uploads are always streamed to a local temp folder first (to hash and validate them).
 */

/** Object store operations; keys look like "books/ab/cd/<sha256>" or "covers/<id>.img". */
interface Driver {
  /** Moves a local temp file into the store (no-op if the key already exists). */
  putFile(key: string, localPath: string): Promise<void>;
  /** Size in bytes, or null when missing. */
  size(key: string): Promise<number | null>;
  /** Byte stream, optionally of an inclusive range. */
  read(key: string, start?: number, end?: number): Promise<Readable>;
  remove(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

const tmpDir = path.join(config.storageDir, "tmp");

class LocalDriver implements Driver {
  private file(key: string) {
    return path.join(config.storageDir, ...key.split("/"));
  }
  async putFile(key: string, localPath: string) {
    const dest = this.file(key);
    try {
      await fs.access(dest);
      await fs.rm(localPath, { force: true });
    } catch {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(localPath, dest);
    }
  }
  async size(key: string) {
    try {
      return (await fs.stat(this.file(key))).size;
    } catch {
      return null;
    }
  }
  async read(key: string, start?: number, end?: number) {
    return createReadStream(this.file(key), start === undefined ? undefined : { start, end });
  }
  async remove(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
  async copy(from: string, to: string) {
    await fs.mkdir(path.dirname(this.file(to)), { recursive: true });
    await fs.copyFile(this.file(from), this.file(to));
  }
}

class S3Driver implements Driver {
  private client = new S3Client({
    endpoint: config.s3.endpoint || undefined,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials:
      config.s3.accessKeyId && config.s3.secretAccessKey
        ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
        : undefined,
  });
  private bucket = config.s3.bucket;

  private isMissing(err: unknown) {
    return err instanceof NotFound || (err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === "NoSuchKey"));
  }
  async putFile(key: string, localPath: string) {
    if ((await this.size(key)) !== null) {
      await fs.rm(localPath, { force: true });
      return;
    }
    const { size } = await fs.stat(localPath);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(localPath), ContentLength: size }),
    );
    await fs.rm(localPath, { force: true });
  }
  async size(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (err) {
      if (this.isMissing(err)) return null;
      throw err;
    }
  }
  async read(key: string, start?: number, end?: number) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: start === undefined ? undefined : `bytes=${start}-${end ?? ""}` }),
    );
    return res.Body as Readable;
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async copy(from: string, to: string) {
    await this.client.send(
      new CopyObjectCommand({ Bucket: this.bucket, Key: to, CopySource: `${this.bucket}/${encodeURIComponent(from).replace(/%2F/g, "/")}` }),
    );
  }
}

const driver: Driver = config.storageDriver === "s3" ? new S3Driver() : new LocalDriver();

export async function ensureStorageDirs() {
  await fs.mkdir(tmpDir, { recursive: true });
  if (config.storageDriver === "local") {
    await Promise.all(["books", "covers"].map((d) => fs.mkdir(path.join(config.storageDir, d), { recursive: true })));
  }
}

export const bookKey = (sha256: string) => `books/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
export const coverKey = (bookId: string) => `covers/${bookId}.img`;

export type TempFile = { tmpPath: string; sha256: string; size: number; head: Buffer };

/** Streams an upload to a temp file while computing its hash and keeping the first bytes. */
export async function streamToTemp(source: Readable, headBytes = 128): Promise<TempFile> {
  const tmpPath = path.join(tmpDir, randomUUID());
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
export function commitBookFile(tmp: TempFile) {
  return driver.putFile(bookKey(tmp.sha256), tmp.tmpPath);
}

export function commitCover(tmpPath: string, bookId: string) {
  return driver.putFile(coverKey(bookId), tmpPath);
}

export async function removeTemp(tmpPath: string | undefined) {
  if (tmpPath) await fs.rm(tmpPath, { force: true });
}

export const objectSize = (key: string) => driver.size(key);
export const readObject = (key: string, start?: number, end?: number) => driver.read(key, start, end);
export const removeBookFile = (sha256: string) => driver.remove(bookKey(sha256));
export const removeCover = (bookId: string) => driver.remove(coverKey(bookId));
export const copyCover = (fromBookId: string, toBookId: string) => driver.copy(coverKey(fromBookId), coverKey(toBookId));

/** First `n` bytes of an object (e.g. to sniff an image type), or null when missing. */
export async function readHead(key: string, n: number) {
  if ((await driver.size(key)) === null) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of await driver.read(key, 0, n - 1)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).subarray(0, n);
}
