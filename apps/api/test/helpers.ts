import { randomBytes } from "node:crypto";
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

/** Multipart upload of a book file. */
export async function upload(user: TestUser, filename: string, data: Buffer, fields: Record<string, string> = {}) {
  const a = await getApp();
  const boundary = `----readsync${randomBytes(6).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
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
