import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { ensureStorageDirs } from "../src/lib/storage.js";

export const ORIGIN = "http://localhost:5173";

let app: FastifyInstance | null = null;

export async function getApp() {
  if (!app) {
    await ensureStorageDirs();
    app = await buildServer();
    await app.ready();
  }
  return app;
}

export type TestUser = { id: string; email: string; cookie: string };

/** Creates an account and returns its session cookie. */
export async function signUp(email = `u${randomBytes(4).toString("hex")}@test.local`, name = "Tester"): Promise<TestUser> {
  const a = await getApp();
  const res = await a.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password: "password123", name },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return { id: res.json().user.id, email, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
}

export async function signIn(email: string, password = "password123"): Promise<TestUser> {
  const a = await getApp();
  const res = await a.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");
  return { id: res.json().user.id, email, cookie };
}

/** The administrator account (ADMIN_EMAILS in vitest.config.ts), shared by all test files. */
export async function adminSession() {
  return signUp("admin@test.local", "Admin").catch(() => signIn("admin@test.local"));
}

/** JSON request as `user` (or anonymous). */
export async function api(user: TestUser | null, method: string, url: string, payload?: unknown) {
  const a = await getApp();
  return a.inject({
    method: method as "GET",
    url,
    headers: {
      origin: ORIGIN,
      ...(user ? { cookie: user.cookie } : {}),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: payload as object,
  });
}

/** A minimal valid-looking PDF (the server only checks the magic bytes). */
export function fakePdf(sizeBytes = 2048) {
  return Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(sizeBytes)]);
}

/** Multipart upload of a book file (and optionally a cover image). */
export async function upload(user: TestUser, filename: string, data: Buffer, fields: Record<string, string> = {}, cover?: Buffer) {
  const a = await getApp();
  const boundary = `----readsync${randomBytes(6).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (cover) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="cover"\r\nContent-Type: application/octet-stream\r\n\r\n`), cover, Buffer.from("\r\n"));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return a.inject({
    method: "POST",
    url: "/api/books",
    headers: { origin: ORIGIN, cookie: user.cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  });
}

/** A real ZIP (stored or deflated entries, with a central directory). */
export function zip(entries: [string, string | Buffer, boolean?][]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
