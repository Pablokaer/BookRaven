import { afterEach, describe, expect, it, vi } from "vitest";
import { openComicArchive } from "./comics";
import { CHUNK, lazyBlob, openRemoteFile } from "./rangeFile";

/** A server holding `data` that answers range requests (or, with `ranges: false`, sends it whole). */
function serve(data: Uint8Array, { ranges = true } = {}) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const range = new Headers(init.headers).get("Range");
      requests.push(range ?? "whole");
      const m = range && ranges ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
      if (!m) return new Response(data as BlobPart, { status: 200 });
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), data.length - 1);
      return new Response(data.slice(start, end + 1) as BlobPart, {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/${data.length}` },
      });
    }),
  );
  return requests;
}

function bytes(n: number) {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = (i * 7 + (i >> 8)) & 0xff;
  return d;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
let opened = 0;

afterEach(() => vi.unstubAllGlobals());

describe("range files", () => {
  it("downloads only the pieces a read needs, in one request, and reuses them", async () => {
    const data = bytes(10 * CHUNK + 123);
    const requests = serve(data);
    const file = await openRemoteFile("/api/books/x/file", `/books/x${++opened}`);
    expect(file.size).toBe(data.length);
    expect(requests).toEqual([`bytes=0-${CHUNK - 1}`]);

    expect(await file.read(5 * CHUNK + 10, 7 * CHUNK + 20)).toEqual(data.slice(5 * CHUNK + 10, 7 * CHUNK + 20));
    expect(requests.slice(1)).toEqual([`bytes=${5 * CHUNK}-${8 * CHUNK - 1}`]);

    // Already downloaded (and the first piece came with the open).
    expect(await file.read(6 * CHUNK, 6 * CHUNK + 5)).toEqual(data.slice(6 * CHUNK, 6 * CHUNK + 5));
    expect(await file.read(100, 200)).toEqual(data.slice(100, 200));
    expect(requests).toHaveLength(2);

    // The last piece is shorter than the others.
    expect(await file.read(data.length - 50, data.length + 999)).toEqual(data.slice(data.length - 50));
  });

  it("reads further ahead while reads follow each other, like a video buffering", async () => {
    const data = bytes(24 * CHUNK);
    const requests = serve(data);
    const file = await openRemoteFile("/api/books/x/file", `/books/x${++opened}`);
    for (let at = CHUNK; at < 12 * CHUNK; at += CHUNK / 2) {
      const got = await file.read(at, at + CHUNK / 2);
      expect(got.length).toBe(CHUNK / 2);
      expect(got[0]).toBe(data[at]);
      expect(got.at(-1)).toBe(data[at + CHUNK / 2 - 1]);
    }
    // 11 pieces read in order took far fewer requests than pieces.
    expect(requests.length).toBeLessThan(5);
  });

  it("prefetches in the background so the next read is already there", async () => {
    const data = bytes(8 * CHUNK);
    const requests = serve(data);
    const file = await openRemoteFile("/api/books/x/file", `/books/x${++opened}`);
    file.prefetch!(3 * CHUNK, 5 * CHUNK);
    await tick();
    expect(requests).toHaveLength(2);
    expect(await file.read(3 * CHUNK + 1, 5 * CHUNK - 1)).toEqual(data.slice(3 * CHUNK + 1, 5 * CHUNK - 1));
    expect(requests).toHaveLength(2);
  });

  it("works with a server that ignores ranges (the whole file comes at once)", async () => {
    const data = bytes(3 * CHUNK);
    const requests = serve(data, { ranges: false });
    const file = await openRemoteFile("/api/books/x/file", `/books/x${++opened}`);
    expect(await file.read(CHUNK, 2 * CHUNK + 3)).toEqual(data.slice(CHUNK, 2 * CHUNK + 3));
    expect(requests).toHaveLength(1);
  });

  it("reuses the file opened last (the reader remounting, switching comic modes)", async () => {
    const requests = serve(bytes(3 * CHUNK));
    const a = openRemoteFile("/api/books/y/file", "/books/y");
    expect(openRemoteFile("/api/books/y/file", "/books/y")).toBe(a);
    await a;
    expect(requests).toHaveLength(1);
  });

  it("gives Blob-like slices of a range file", async () => {
    const data = bytes(4 * CHUNK);
    serve(data);
    const file = await openRemoteFile("/api/books/x/file", `/books/x${++opened}`);
    const blob = lazyBlob(file, "book.mobi");
    expect(blob.size).toBe(data.length);
    const part = blob.slice(CHUNK + 4, 3 * CHUNK).slice(10, 20);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.slice(CHUNK + 14, CHUNK + 24));
    expect(blob.slice(-5).size).toBe(5);
  });
});

/** A ZIP with entries stored as they are (as comic pages usually are). */
function storedZip(files: Record<string, Uint8Array>) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (d: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of d) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const out: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  let count = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const offset = out.length;
    const sum = crc(data);
    u32(out, 0x04034b50), u16(out, 10), u16(out, 0), u16(out, 0), u16(out, 0), u16(out, 0x21);
    u32(out, sum), u32(out, data.length), u32(out, data.length), u16(out, nameBytes.length), u16(out, 0);
    for (const b of nameBytes) out.push(b);
    for (const b of data) out.push(b);
    u32(central, 0x02014b50), u16(central, 20), u16(central, 10), u16(central, 0), u16(central, 0), u16(central, 0), u16(central, 0x21);
    u32(central, sum), u32(central, data.length), u32(central, data.length), u16(central, nameBytes.length);
    u16(central, 0), u16(central, 0), u16(central, 0), u16(central, 0), u32(central, 0), u32(central, offset);
    central.push(...nameBytes);
    count++;
  }
  const cdOffset = out.length;
  out.push(...central);
  u32(out, 0x06054b50), u16(out, 0), u16(out, 0), u16(out, count), u16(out, count), u32(out, central.length), u32(out, cdOffset), u16(out, 0);
  return Uint8Array.from(out);
}

describe("comics read by ranges", () => {
  it("opens a CBZ from its directory and downloads pages (and the next ones) when shown", async () => {
    // A PNG header (1600x1000, a double-page scan) followed by filler.
    const png = (w: number, h: number) => {
      const d = bytes(3 * CHUNK);
      d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(d.buffer).setUint32(16, w);
      new DataView(d.buffer).setUint32(20, h);
      return d;
    };
    const pages = { "p10.png": png(800, 1200), "p2.png": png(1600, 1000), "p1.png": png(800, 1200), "notes.txt": bytes(10) };
    const zip = storedZip(pages);
    const requests = serve(zip);
    const file = await openRemoteFile("/api/books/c/file", "/books/c");
    const comic = await openComicArchive(file, "cbz");
    expect(comic.pages.map((p) => p.name)).toEqual(["p1.png", "p2.png", "p10.png"]);
    // Opening read the first piece and the directory at the end, no page data.
    expect(requests.length).toBeLessThanOrEqual(2);

    const head = new Uint8Array(await (await comic.loadHead!("p2.png", 4096)).arrayBuffer());
    expect(head).toEqual(pages["p2.png"].subarray(0, 4096));
    // Just those bytes, not the 64 KB pieces around them.
    expect(requests.at(-1)).toMatch(/^bytes=\d+-\d+$/);
    const [from, to] = requests.at(-1)!.slice(6).split("-").map(Number);
    expect(to! - from! + 1).toBeLessThan(6 * 1024);

    const before = requests.length;
    const page = new Uint8Array(await (await comic.loadPage("p1.png")).arrayBuffer());
    expect(page).toEqual(pages["p1.png"]);
    await tick();
    // The next pages were requested in the background...
    expect(requests.length).toBeGreaterThan(before + 1);
    const after = requests.length;
    expect(new Uint8Array(await (await comic.loadPage("p2.png")).arrayBuffer())).toEqual(pages["p2.png"]);
    // ...so showing the next page needed no request of its own.
    expect(requests.length).toBe(after);
  });
});
