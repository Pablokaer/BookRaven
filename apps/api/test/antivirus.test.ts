import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { query } from "../src/db.js";
import { InfectedFileError, scanFile, ScannerUnavailableError } from "../src/lib/antivirus.js";
import { ensureLibraryAccount, storePublicBook } from "../src/lib/gutenbergImport.js";
import { auditLog } from "../src/lib/log.js";
import { bookKey, objectSize, streamToTemp } from "../src/lib/storage.js";
import { api, fakePdf, signUp, upload } from "./helpers.js";

/** What the fake clamd reports as a virus (not the real EICAR string, which antivirus software on a developer's machine would quarantine). */
const MARKER = "FAKE-VIRUS-FOR-BOOKRAVEN-TESTS";

type Stream = { command: string; chunks: number[]; data: Buffer };

/**
 * A fake clamd: parses the INSTREAM framing (command up to NUL, then length-prefixed chunks up
 * to a zero-length one) and answers like clamd. `mode` picks the answer: "auto" (FOUND for data
 * holding MARKER, otherwise OK), "error" (clamd's size-limit error, sent as soon as the command
 * arrives, then the connection closes), "hang" (never answers), "close" (drops the connection).
 */
async function fakeClamd() {
  const state = { mode: "auto" as "auto" | "error" | "hang" | "close", streams: [] as Stream[] };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const chunks: number[] = [];
    const parts: Buffer[] = [];
    socket.on("data", (data) => {
      buf = Buffer.concat([buf, data]);
      if (command === null) {
        const end = buf.indexOf(0);
        if (end === -1) return;
        command = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 1);
        if (state.mode === "error") return void socket.end("INSTREAM size limit exceeded. ERROR\0");
      }
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (buf.length < 4 + n) return;
        const chunk = buf.subarray(4, 4 + n);
        buf = buf.subarray(4 + n);
        if (n > 0) {
          chunks.push(n);
          parts.push(chunk);
          continue;
        }
        const stream = { command, chunks, data: Buffer.concat(parts) };
        state.streams.push(stream);
        if (state.mode === "close") return void socket.destroy();
        if (state.mode === "hang") return;
        return void socket.end(stream.data.includes(MARKER) ? "stream: Fake.Test-Signature FOUND\0" : "stream: OK\0");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    state,
    port,
    scanner: { host: "127.0.0.1", port, timeoutMs: 300 },
    close: () => {
      sockets.forEach((s) => s.destroy());
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A port nothing listens on. */
async function closedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let clamd: Awaited<ReturnType<typeof fakeClamd>>;
let dir: string;
beforeAll(async () => {
  clamd = await fakeClamd();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bookraven-av-"));
});
afterAll(async () => {
  await clamd.close();
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  clamd.state.mode = "auto";
  clamd.state.streams = [];
});

async function tempFile(name: string, data: Buffer) {
  const file = path.join(dir, name);
  await fs.writeFile(file, data);
  return file;
}

describe("clamd client", () => {
  it("sends the file in length-prefixed chunks and reads a clean answer", async () => {
    const data = Buffer.alloc(150 * 1024, 7); // three chunks: 64 + 64 + 22 KB
    expect(await scanFile(await tempFile("clean.bin", data), clamd.scanner)).toEqual({ clean: true });
    const [stream] = clamd.state.streams;
    expect(stream!.command).toBe("zINSTREAM");
    expect(stream!.chunks).toEqual([65536, 65536, 22 * 1024]);
    expect(stream!.data.equals(data)).toBe(true);
  });

  it("sends an empty file as just the end of the stream", async () => {
    expect(await scanFile(await tempFile("empty.bin", Buffer.alloc(0)), clamd.scanner)).toEqual({ clean: true });
    expect(clamd.state.streams[0]).toMatchObject({ chunks: [], data: Buffer.alloc(0) });
  });

  it("reports the signature of an infected file", async () => {
    const file = await tempFile("bad.bin", Buffer.from(`some bytes ${MARKER} more`));
    expect(await scanFile(file, clamd.scanner)).toEqual({ clean: false, signature: "Fake.Test-Signature" });
  });

  it("is unavailable on a clamd error, even one sent before the whole file", async () => {
    clamd.state.mode = "error";
    const file = await tempFile("big.bin", Buffer.alloc(4 * 1024 * 1024));
    await expect(scanFile(file, clamd.scanner)).rejects.toThrow(new ScannerUnavailableError("INSTREAM size limit exceeded. ERROR"));
  });

  it("is unavailable when clamd can't be reached, drops the connection or stays silent", async () => {
    const file = await tempFile("x.bin", Buffer.from("x"));
    await expect(scanFile(file, { host: "127.0.0.1", port: await closedPort() })).rejects.toBeInstanceOf(ScannerUnavailableError);
    clamd.state.mode = "close";
    await expect(scanFile(file, clamd.scanner)).rejects.toThrow(/closed without an answer/);
    clamd.state.mode = "hang";
    await expect(scanFile(file, clamd.scanner)).rejects.toThrow(/no answer in time/);
  });

  it("does not blame the scanner for a file that can't be read", async () => {
    await expect(scanFile(path.join(dir, "missing.bin"), clamd.scanner)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("always passes files while scanning is off", async () => {
    expect(config.clamav.host).toBe("");
    expect(await scanFile(path.join(dir, "missing.bin"))).toEqual({ clean: true });
    expect(clamd.state.streams).toHaveLength(0);
  });
});

describe("virus check of uploads and imports", () => {
  const warnings: { event: string; [field: string]: unknown }[] = [];
  beforeEach(() => {
    config.clamav = { host: "127.0.0.1", port: clamd.port };
    warnings.length = 0;
    vi.spyOn(auditLog, "warn").mockImplementation(((obj: { event: string }) => void warnings.push(obj)) as never);
  });
  afterEach(() => {
    config.clamav = { host: "", port: 3310 };
    vi.restoreAllMocks();
  });

  const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const used = async (u: Awaited<ReturnType<typeof signUp>>) => (await api(u, "GET", "/api/me")).json().usedBytes;

  it("scans every upload, and stores clean ones", async () => {
    const u = await signUp();
    const file = fakePdf();
    expect((await upload(u, "clean.pdf", file)).statusCode).toBe(201);
    expect(clamd.state.streams.map((s) => s.data.equals(file))).toEqual([true]);
  });

  it("refuses an infected file or cover: nothing stored, no storage used", async () => {
    const u = await signUp();
    const file = Buffer.concat([fakePdf(), Buffer.from(MARKER)]);
    const res = await upload(u, "bad.pdf", file);
    expect([res.statusCode, res.json()]).toEqual([422, { error: "infected" }]);
    expect(await objectSize(bookKey(sha(file)))).toBeNull();
    expect((await api(u, "GET", "/api/books")).json()).toHaveLength(0);
    expect(await used(u)).toBe(0);
    expect(warnings).toEqual([expect.objectContaining({ event: "upload.infected", userId: u.id, signature: "Fake.Test-Signature", sha256: sha(file), part: "file" })]);

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(MARKER)]);
    const clean = fakePdf();
    const withCover = await upload(u, "c.pdf", clean, {}, png);
    expect([withCover.statusCode, withCover.json()]).toEqual([422, { error: "infected" }]);
    expect(await objectSize(bookKey(sha(clean)))).toBeNull();
    expect(warnings[1]).toMatchObject({ part: "cover" });
  });

  it("refuses uploads while the scanner is unavailable (fail closed)", async () => {
    const u = await signUp();
    const file = fakePdf();
    config.clamav = { host: "127.0.0.1", port: await closedPort() };
    const res = await upload(u, "a.pdf", file);
    expect([res.statusCode, res.json(), res.headers["retry-after"]]).toEqual([503, { error: "scanner_unavailable" }, "60"]);
    expect(await objectSize(bookKey(sha(file)))).toBeNull();
    expect(await used(u)).toBe(0);
  });

  it("refuses an infected public-domain import before storing it", async () => {
    const ownerId = await ensureLibraryAccount();
    const data = Buffer.from(`PK\x03\x04 not really an epub ${MARKER} ${Math.random()}`);
    const file = await streamToTemp(Readable.from([data]));
    const meta = {
      source: "gutenberg",
      sourceId: "999999",
      sourceUrl: "https://www.gutenberg.org/ebooks/999999",
      title: "Infected",
      authors: [],
      translators: [],
      language: "en",
      subjects: [],
      themes: [],
      tags: [],
      description: null,
      popularity: 0,
    };
    await expect(storePublicBook(ownerId, file, meta, [], fetch)).rejects.toBeInstanceOf(InfectedFileError);
    expect((await query("SELECT 1 FROM book WHERE sha256 = $1", [file.sha256])).rowCount).toBe(0);
    expect(await objectSize(bookKey(file.sha256))).toBeNull();
    expect(warnings[0]).toMatchObject({ event: "import.infected", sourceId: "999999", signature: "Fake.Test-Signature" });
    await fs.rm(file.tmpPath, { force: true });
  });
});
