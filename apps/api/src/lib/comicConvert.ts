import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { config } from "../config.js";
import { bookKey, cbzKey, objectSize, putObject, readObject, tmpDir } from "./storage.js";

/**
 * RAR, 7z and TAR comics can't be read a page at a time (RAR and 7z are usually "solid":
 * page 50 can't be unpacked without unpacking pages 1-49). The server keeps a CBZ copy of
 * them (pages stored uncompressed, as they were in the archive), which readers fetch with
 * HTTP range requests like any CBZ: only the pages around the one being read are downloaded.
 */
export const CONVERTED_FORMATS: ReadonlySet<string> = new Set(["cbr", "cb7", "cbt"]);

/** Longest a conversion may run before it is given up. */
const TIMEOUT_MS = 10 * 60 * 1000;

const sevenZipUrl = pathToFileURL(createRequire(import.meta.url).resolve("7z-wasm")).href;

/**
 * Runs in a worker thread (7-Zip is synchronous WebAssembly and would block the server).
 * The temp folder is mounted into 7-Zip's file system, so archives never sit in memory.
 */
const WORKER = `
const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const { dir, moduleUrl, maxBytes } = workerData;

async function run(args, cwd) {
  const { default: SevenZip } = await import(moduleUrl);
  let out = "";
  const sz = await SevenZip({ print: (s) => (out += s + "\\n"), printErr: () => {} });
  sz.FS.mkdir("/w");
  sz.FS.mount(sz.NODEFS, { root: dir }, "/w");
  if (cwd) sz.FS.chdir(cwd);
  let code;
  try {
    code = sz.callMain(args) ?? 0;
  } catch (err) {
    code = typeof err?.status === "number" ? err.status : 2;
  }
  return { code, out };
}

/** Keeps only plain files and folders (no links pointing outside the archive). */
function prune(at) {
  for (const name of fs.readdirSync(at)) {
    const p = path.join(at, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) prune(p);
    else if (!st.isFile()) fs.rmSync(p, { force: true });
  }
}

(async () => {
  // -p- : never prompt for a password (encrypted archives fail instead of hanging)
  const list = await run(["l", "-slt", "-p-", "/w/in"]);
  if (list.code > 1) throw new Error("unreadable archive");
  let total = 0;
  for (const m of list.out.matchAll(/^Size = (\\d+)$/gm)) total += Number(m[1]);
  if (total > maxBytes) throw new Error("archive too large when unpacked");
  const x = await run(["x", "/w/in", "-o/w/out", "-y", "-p-", "-bso0", "-bsp0"]);
  if (x.code > 1) throw new Error("damaged or password-protected archive");
  prune(path.join(dir, "out"));
  const zip = await run(["a", "-tzip", "-mx=0", "-bso0", "-bsp0", "/w/out.cbz", "*"], "/w/out");
  if (zip.code > 1) throw new Error("could not write the CBZ copy");
})().then(
  () => parentPort.postMessage({ ok: true }),
  (err) => parentPort.postMessage({ error: String(err?.message ?? err) }),
);
`;

function runWorker(dir: string) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(WORKER, {
      eval: true,
      // Comic pages are already compressed images: the CBZ is about as big as the archive.
      workerData: { dir, moduleUrl: sevenZipUrl, maxBytes: 2 * config.maxUploadBytes + 64 * 1024 * 1024 },
    });
    const timer = setTimeout(() => void worker.terminate(), TIMEOUT_MS);
    worker.once("message", (m: { ok?: true; error?: string }) => (m.ok ? resolve() : reject(new ArchiveError(m.error ?? "conversion failed"))));
    worker.once("error", reject);
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("conversion stopped"));
    });
  });
}

class ArchiveError extends Error {}

/** One conversion at a time: they are CPU and disk heavy. */
let queue: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<string | null>>();
/** Archives 7-Zip could not convert (damaged, encrypted, too large): not retried until restart. */
const failed = new Set<string>();

async function convert(sha256: string, key: string) {
  const dir = path.join(tmpDir, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  try {
    await pipeline(await readObject(bookKey(sha256)), createWriteStream(path.join(dir, "in")));
    await runWorker(dir);
    await putObject(key, path.join(dir, "out.cbz"));
    return key;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Storage key of the CBZ copy of a RAR/7z/TAR comic, made on first use (uploads start it
 * in the background). Null when the archive can't be converted.
 */
export function comicAsCbz(sha256: string): Promise<string | null> {
  if (failed.has(sha256)) return Promise.resolve(null);
  const running = inflight.get(sha256);
  if (running) return running;
  const key = cbzKey(sha256);
  const job = (async () => {
    if ((await objectSize(key)) !== null) return key;
    const run = queue.then(() => convert(sha256, key));
    queue = run.catch(() => {});
    try {
      return await run;
    } catch (err) {
      if (err instanceof ArchiveError) failed.add(sha256);
      else throw err;
      return null;
    }
  })().finally(() => inflight.delete(sha256));
  inflight.set(sha256, job);
  return job;
}
