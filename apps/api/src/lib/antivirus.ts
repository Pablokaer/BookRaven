import { createReadStream } from "node:fs";
import net from "node:net";
import { config } from "../config.js";

/**
 * Virus scanning of uploaded files with ClamAV's daemon (clamd, the "clamav" service in
 * docker-compose.yml), over its INSTREAM protocol on TCP: the command, then the file in chunks
 * each prefixed with its length (4 bytes, big-endian), then a zero-length chunk; clamd answers
 * "stream: OK", "stream: <signature> FOUND" or "<reason> ERROR".
 */

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** clamd could not be reached, timed out or could not scan the file: callers refuse the file (fail closed). */
export class ScannerUnavailableError extends Error {
  constructor(reason: string) {
    super(`virus scanner unavailable: ${reason}`);
  }
}

/** Thrown by imports for a file clamd found a virus in. */
export class InfectedFileError extends Error {
  constructor(readonly signature: string) {
    super(`infected (${signature})`);
  }
}

export type Scanner = {
  host: string;
  port: number;
  /** Giving up on connecting (default 5 s). */
  connectTimeoutMs?: number;
  /**
   * Giving up when clamd stays silent (default 150 s): longer than clamd's MaxScanTime
   * (120 s in infra/clamav/clamd.conf), so a big archive gets its answer.
   */
  timeoutMs?: number;
};

/** Read lazily, so tests can point it at a fake clamd. */
export const scanningEnabled = () => config.clamav.host !== "";

/** Bytes per INSTREAM chunk; clamd's StreamMaxLength limits the total, not the chunks. */
const CHUNK = 64 * 1024;

/**
 * Scans a local file. Always clean when scanning is off (no CLAMAV_HOST); throws
 * ScannerUnavailableError when it is on and clamd gives no verdict.
 */
export async function scanFile(file: string, scanner: Scanner | null = scanningEnabled() ? config.clamav : null): Promise<ScanResult> {
  if (!scanner) return { clean: true };
  const socket = net.connect({ host: scanner.host, port: scanner.port });
  const connectTimer = setTimeout(() => socket.destroy(new Error("connection timed out")), scanner.connectTimeoutMs ?? 5000);
  socket.once("connect", () => {
    clearTimeout(connectTimer);
    socket.setTimeout(scanner.timeoutMs ?? 150_000, () => socket.destroy(new Error("no answer in time")));
  });

  // The answer ends with a NUL (the "z" command prefix). clamd may answer before the whole file
  // is sent (e.g. "INSTREAM size limit exceeded"), then closes the connection.
  const answer = new Promise<string>((resolve, reject) => {
    const received: Buffer[] = [];
    socket.on("data", (data) => {
      received.push(data);
      const all = Buffer.concat(received);
      const end = all.indexOf(0);
      if (end !== -1) resolve(all.subarray(0, end).toString("utf8").trim());
    });
    socket.once("error", (err) => reject(new ScannerUnavailableError(err.message)));
    socket.once("close", () => reject(new ScannerUnavailableError("connection closed without an answer")));
  });
  answer.catch(() => {}); // awaited below; not unhandled while the file is still being sent

  let readError: unknown;
  const sending = (async () => {
    /** Resolves when the socket can take more, or is gone. */
    const writable = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          socket.off("drain", done);
          socket.off("close", done);
          resolve();
        };
        socket.on("drain", done);
        socket.on("close", done);
      });
    const send = async (data: Buffer) => {
      if (!socket.destroyed && !socket.write(data)) await writable();
    };
    await send(Buffer.from("zINSTREAM\0"));
    for await (const chunk of createReadStream(file, { highWaterMark: CHUNK }) as AsyncIterable<Buffer>) {
      if (socket.destroyed) return;
      const length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length);
      await send(Buffer.concat([length, chunk]));
    }
    await send(Buffer.alloc(4)); // end of stream
  })().catch((err) => {
    readError = err;
    socket.destroy();
  });

  try {
    const reply = await answer.catch((err) => {
      if (readError) throw readError; // our file, not the scanner
      throw err;
    });
    const found = /^stream: (.+) FOUND$/.exec(reply);
    if (found) return { clean: false, signature: found[1]! };
    if (reply === "stream: OK") return { clean: true };
    throw new ScannerUnavailableError(reply.replace(/^stream: /, "") || "empty answer");
  } finally {
    clearTimeout(connectTimer);
    socket.destroy();
    await sending;
  }
}
