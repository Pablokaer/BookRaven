import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { query } from "../db.js";
import { bookKey, readHead, readObject } from "./storage.js";

/**
 * KOReader's "partial MD5" document id: md5 of 1 KB samples taken at offsets
 * 0, 1 KB, 4 KB, 16 KB … 1 GB (1024 << 2i), stopping at the end of the file.
 * Matches util.partialMD5 in KOReader, so its sync requests can be matched to our books.
 */
export async function partialMd5(read: (offset: number, length: number) => Promise<Buffer>, size: number) {
  const md5 = createHash("md5");
  for (let i = -1; i <= 10; i++) {
    const offset = i < 0 ? 0 : 1024 << (2 * i);
    if (offset >= size) break;
    md5.update(await read(offset, Math.min(1024, size - offset)));
  }
  return md5.digest("hex");
}

/** For a temp upload on local disk. */
export async function partialMd5OfFile(path: string, size: number) {
  const fh = await fs.open(path, "r");
  try {
    return await partialMd5(async (offset, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    }, size);
  } finally {
    await fh.close();
  }
}

/** For a stored book (local disk or S3), reading only the samples. */
export async function partialMd5OfStored(sha256: string, size: number) {
  const key = bookKey(sha256);
  return partialMd5(async (offset, length) => {
    if (offset === 0) return (await readHead(key, length)) ?? Buffer.alloc(0);
    const chunks: Buffer[] = [];
    for await (const c of await readObject(key, offset, offset + length - 1)) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }, size);
}

/** Fills in the KOReader id of books uploaded before it existed (runs in the background at startup). */
export async function backfillKoreaderHashes(log: (msg: string) => void) {
  const { rows } = await query<{ sha256: string; size_bytes: string }>(
    "SELECT DISTINCT sha256, size_bytes FROM book WHERE koreader_md5 IS NULL LIMIT 5000",
  );
  for (const r of rows) {
    try {
      const md5 = await partialMd5OfStored(r.sha256, Number(r.size_bytes));
      await query("UPDATE book SET koreader_md5 = $1 WHERE sha256 = $2 AND koreader_md5 IS NULL", [md5, r.sha256]);
    } catch (err) {
      log(`koreader hash failed for ${r.sha256}: ${(err as Error).message}`);
    }
  }
  if (rows.length) log(`KOReader ids computed for ${rows.length} files`);
}
