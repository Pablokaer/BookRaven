import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The S3 driver against an in-process S3-compatible server (s3rver). */
describe("S3 storage driver", () => {
  let server: S3rver;
  let dir: string;
  let storage: typeof import("../src/lib/storage.js");
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "s3rver-"));
    server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: "readsync", configs: [] }] });
    const { port } = (await server.run()) as unknown as { port: number };
    Object.assign(process.env, {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_BUCKET: "readsync",
      S3_ACCESS_KEY_ID: "S3RVER",
      S3_SECRET_ACCESS_KEY: "S3RVER",
    });
    storage = await import("../src/lib/storage.js"); // fresh module: reads the env above
    await storage.ensureStorageDirs();
  });

  afterAll(async () => {
    process.env = saved;
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function text(stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks);
  }

  it("stores, reads ranges, copies and removes objects", async () => {
    const data = randomBytes(4096);
    const { Readable } = await import("node:stream");
    const tmp = await storage.streamToTemp(Readable.from([data]));
    expect(tmp.size).toBe(4096);

    await storage.commitBookFile(tmp);
    const key = storage.bookKey(tmp.sha256);
    expect(await storage.objectSize(key)).toBe(4096);
    await expect(fs.access(tmp.tmpPath)).rejects.toThrow(); // temp file was cleaned up

    expect((await text(await storage.readObject(key, 10, 19))).equals(data.subarray(10, 20))).toBe(true);
    expect((await text(await storage.readObject(key))).equals(data)).toBe(true);

    // covers: put + copy + head sniffing
    const coverTmp = path.join(dir, "cover.tmp");
    await fs.writeFile(coverTmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    await storage.commitCover(coverTmp, "a");
    await storage.copyCover("a", "b");
    expect((await storage.readHead(storage.coverKey("b"), 2))?.equals(Buffer.from([0xff, 0xd8]))).toBe(true);

    await storage.removeBookFile(tmp.sha256);
    expect(await storage.objectSize(key)).toBeNull();
    expect(await storage.readHead(storage.coverKey("missing"), 4)).toBeNull();
  });
});
