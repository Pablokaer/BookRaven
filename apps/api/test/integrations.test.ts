import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { partialMd5 } from "../src/lib/koreader.js";
import { api, fakePdf, getApp, signUp, upload, type TestUser } from "./helpers.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

async function appPassword(u: TestUser, name = "Kobo") {
  const res = await api(u, "POST", "/api/app-passwords", { name });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; password: string };
}

async function basic(u: TestUser, password: string, url: string) {
  const a = await getApp();
  return a.inject({ method: "GET", url, headers: { authorization: `Basic ${Buffer.from(`${u.email}:${password}`).toString("base64")}` } });
}

describe("app passwords and OPDS", () => {
  it("serves the library as an OPDS catalog to app passwords only", async () => {
    const u = await signUp();
    const book = (await upload(u, "Dune.pdf", fakePdf(), { title: "Dune & Co", author: "Frank Herbert" })).json();
    const { id, password } = await appPassword(u);
    expect(password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    expect((await (await getApp()).inject({ method: "GET", url: "/opds" })).statusCode).toBe(401);
    expect((await basic(u, "password123", "/opds")).statusCode).toBe(401); // the account password is not accepted

    const root = await basic(u, password, "/opds");
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toMatch(/atom\+xml/);
    expect(root.body).toContain('href="/opds/library"');

    const lib = await basic(u, password, "/opds/library");
    expect(lib.body).toContain("<title>Dune &amp; Co</title>");
    expect(lib.body).toContain(`href="/opds/books/${book.id}/file"`);
    expect((await basic(u, password, `/opds/books/${book.id}/file`)).headers["content-disposition"]).toMatch(/attachment/);
    expect((await basic(u, password, "/opds/search?q=herbert")).body).toContain("Dune &amp; Co");
    expect((await basic(u, password, "/opds/search?q=nothing")).body).not.toContain("<entry>");

    const other = await signUp();
    expect((await basic(other, password, "/opds")).statusCode).toBe(401); // tied to its account
    const list = (await api(u, "GET", "/api/app-passwords")).json();
    expect(list[0]).toMatchObject({ name: "Kobo" });
    expect(list[0].lastUsedAt).toBeTruthy();
    expect((await api(u, "DELETE", `/api/app-passwords/${id}`)).statusCode).toBe(204);
    expect((await basic(u, password, "/opds")).statusCode).toBe(401);
  });
});

describe("KOReader sync", () => {
  it("computes KOReader's partial MD5", async () => {
    // Reference: md5 of 1 KB samples at 0, 1K, 4K, 16K, 64K, 256K, … until the end of the file.
    const data = Buffer.alloc(300_000).map((_, i) => (i * 7) % 251);
    const ref = createHash("md5");
    for (const off of [0, 1024, 4096, 16384, 65536, 262144]) ref.update(data.subarray(off, off + 1024));
    const ours = await partialMd5(async (o, l) => data.subarray(o, o + l), data.length);
    expect(ours).toBe(ref.digest("hex"));
  });

  it("syncs PDF pages both ways and mirrors positions into BookRaven", async () => {
    const u = await signUp();
    const file = fakePdf(100_000);
    const book = (await upload(u, "k.pdf", file)).json();
    const { password } = await appPassword(u, "KOReader");
    const doc = await partialMd5(async (o, l) => file.subarray(o, o + l), file.length);
    const a = await getApp();
    const ko = (method: string, url: string, payload?: object, key = md5(password)) =>
      a.inject({
        method: method as "GET",
        url,
        headers: { "x-auth-user": u.email, "x-auth-key": key, accept: "application/vnd.koreader.v1+json", "content-type": "application/vnd.koreader.v1+json" },
        payload: payload ? JSON.stringify(payload) : undefined,
      });

    expect((await ko("GET", "/kosync/users/auth", undefined, md5("wrong"))).statusCode).toBe(401);
    expect((await ko("GET", "/kosync/users/auth")).json()).toEqual({ authorized: "OK" });
    expect((await ko("POST", "/kosync/users/create", { username: "x", password: "y" })).statusCode).toBe(403);
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toEqual({});

    const put = await ko("PUT", "/kosync/syncs/progress", { document: doc, progress: "5", percentage: 0.25, device: "Kobo Libra", device_id: "abc" });
    expect(put.json()).toMatchObject({ document: doc });
    const mirrored = (await api(u, "GET", `/api/books/${book.id}/progress`)).json();
    expect(mirrored).toMatchObject({ locator: "page:5", percentage: 0.25, deviceName: "KOReader (Kobo Libra)" });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({ progress: "5", device: "Kobo Libra" });

    // Reading further in BookRaven: KOReader gets that page back.
    await new Promise((r) => setTimeout(r, 1100));
    await api(u, "PUT", `/api/books/${book.id}/progress`, { locator: "page:9", percentage: 0.45, deviceId: "web", deviceName: "Firefox", clientUpdatedAt: Date.now() });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({ progress: "9", percentage: 0.45, device: "Firefox" });

    // A percentage (the book marked as read by an import) names no page here: KOReader keeps its own.
    await new Promise((r) => setTimeout(r, 1100));
    await api(u, "PUT", `/api/books/${book.id}/progress`, { locator: "fraction:1", percentage: 1, deviceId: "import", deviceName: "Import", clientUpdatedAt: Date.now() });
    expect((await ko("GET", `/kosync/syncs/progress/${doc}`)).json()).toMatchObject({ progress: "5", device: "Kobo Libra" });
  });
});
