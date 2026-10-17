import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { FastifyReply } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/app.js";
import { auth } from "../src/auth.js";
import { config } from "../src/config.js";
import { pool, query } from "../src/db.js";
import { subscribe } from "../src/lib/events.js";
import { auditLog } from "../src/lib/log.js";
import { define } from "../src/lib/lookup.js";
import { outbox } from "../src/lib/mailer.js";
import { coverKey, removeCover } from "../src/lib/storage.js";
import { adminSession, api, fakePdf, getApp, ORIGIN, signIn, signUp, upload, type TestUser } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

/** The SQL statements run through the pool from now on. */
function watchQueries() {
  const spy = vi.spyOn(pool, "query");
  return () => spy.mock.calls.map((c) => String(c[0]));
}

const get = async (url: string, headers: Record<string, string>) => (await getApp()).inject({ method: "GET", url, headers: { origin: ORIGIN, ...headers } });

/** The emailed reset link, followed: the token it leads to. */
async function resetToken(email: string) {
  await api(null, "POST", "/api/auth/request-password-reset", { email, redirectTo: `${ORIGIN}/reset-password` });
  const link = new URL(outbox.findLast((m) => m.to === email && /reset/i.test(m.subject))!.text.match(/https?:\/\/\S+/)![0]);
  const verify = await (await getApp()).inject({ method: "GET", url: link.pathname + link.search });
  return new URL(verify.headers.location as string).searchParams.get("token")!;
}

describe("session cache", () => {
  it("checks a session once, not on every request", async () => {
    const u = await signUp();
    const spy = vi.spyOn(auth.api, "getSession");
    for (let i = 0; i < 3; i++) expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never outlives the session", async () => {
    // A session kept "until the browser closes" is not extended when used.
    const { email } = await signUp();
    const res = await api(null, "POST", "/api/auth/sign-in/email", { email, password: "password123", rememberMe: false });
    const u = { id: res.json().user.id, email, cookie: ([] as string[]).concat(res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ") };
    await query(`UPDATE session SET "expiresAt" = now() + interval '1 second' WHERE "userId" = $1`, [u.id]);
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401);
  });

  // Each one: a request (now cached), the revocation, then the very next request is refused.
  it("signs out at once, with a cookie or a bearer token", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(u, "POST", "/api/auth/sign-out", {})).statusCode).toBe(200);
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401);

    const signedIn = await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "password123" });
    const bearer = { authorization: `Bearer ${signedIn.headers["set-auth-token"]}` };
    expect((await get("/api/me", bearer)).statusCode).toBe(200);
    const out = await (await getApp()).inject({ method: "POST", url: "/api/auth/sign-out", headers: { origin: ORIGIN, "content-type": "application/json", ...bearer }, payload: {} });
    expect(out.statusCode).toBe(200);
    expect((await get("/api/me", bearer)).statusCode).toBe(401);
  });

  it("signs other devices out when the password changes or sessions are revoked", async () => {
    const u = await signUp();
    const phone = await signIn(u.email);
    expect((await api(phone, "GET", "/api/me")).statusCode).toBe(200);
    const changed = await api(u, "POST", "/api/auth/change-password", { currentPassword: "password123", newPassword: "newpassword456", revokeOtherSessions: true });
    expect(changed.statusCode).toBe(200);
    expect((await api(phone, "GET", "/api/me")).statusCode).toBe(401);

    const laptop = await signIn(u.email, "newpassword456");
    const tablet = await signIn(u.email, "newpassword456");
    expect((await api(tablet, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(laptop, "POST", "/api/auth/revoke-other-sessions", {})).statusCode).toBe(200);
    expect((await api(tablet, "GET", "/api/me")).statusCode).toBe(401);
    expect((await api(laptop, "GET", "/api/me")).statusCode).toBe(200);
  });

  it("signs everyone out after a password reset", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(null, "POST", "/api/auth/reset-password", { newPassword: "brandnew789", token: await resetToken(u.email) })).statusCode).toBe(200);
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401);
  });

  it("signs out at once a blocked account, a temporary password and a deleted account", async () => {
    const admin = await adminSession();
    const blocked = await signUp();
    expect((await api(blocked, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(admin, "PATCH", `/api/admin/users/${blocked.id}`, { blocked: true })).statusCode).toBe(204);
    expect((await api(blocked, "GET", "/api/me")).statusCode).toBe(401);

    const reset = await signUp();
    expect((await api(reset, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(admin, "POST", `/api/admin/users/${reset.id}/reset-password`)).statusCode).toBe(200);
    expect((await api(reset, "GET", "/api/me")).statusCode).toBe(401);

    const deleted = await signUp();
    expect((await api(deleted, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(admin, "DELETE", `/api/admin/users/${deleted.id}`)).statusCode).toBe(204);
    expect((await api(deleted, "GET", "/api/me")).statusCode).toBe(401);
  });

  it("uses a new name at once", async () => {
    const u = await signUp(undefined, "Old Name");
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    expect((await api(u, "POST", "/api/auth/update-user", { name: "New Name" })).statusCode).toBe(200);
    expect((await api(u, "POST", "/api/requests", { title: "A cached book" })).statusCode).toBe(201);
    const mail = outbox.findLast((m) => m.to === "admin@test.local" && m.subject === "New book request: A cached book")!;
    expect(mail.text).toContain("New Name asked for");
  });
});

describe("app-password cache", () => {
  async function device(u: TestUser) {
    const { id, password } = (await api(u, "POST", "/api/app-passwords", { name: "Kobo" })).json();
    const opds = async (url = "/opds") => get(url, { authorization: `Basic ${Buffer.from(`${u.email}:${password}`).toString("base64")}` });
    return { id, opds };
  }

  it("checks an app password once, and still records when it was used", async () => {
    const u = await signUp();
    const { opds } = await device(u);
    const sql = watchQueries();
    for (let i = 0; i < 3; i++) expect((await opds()).statusCode).toBe(200);
    expect(sql().filter((s) => s.includes("FROM app_password p JOIN"))).toHaveLength(1);
    expect((await api(u, "GET", "/api/app-passwords")).json()[0].lastUsedAt).toBeTruthy();
  });

  it("refuses at once a revoked password, a blocked account and a deleted account", async () => {
    const admin = await adminSession();
    const revoked = await signUp();
    const kobo = await device(revoked);
    expect((await kobo.opds()).statusCode).toBe(200);
    expect((await api(revoked, "DELETE", `/api/app-passwords/${kobo.id}`)).statusCode).toBe(204);
    expect((await kobo.opds()).statusCode).toBe(401);

    const blocked = await signUp();
    const kindle = await device(blocked);
    expect((await kindle.opds()).statusCode).toBe(200);
    expect((await api(admin, "PATCH", `/api/admin/users/${blocked.id}`, { blocked: true })).statusCode).toBe(204);
    const events: { event: string }[] = [];
    vi.spyOn(auditLog, "warn").mockImplementation(((obj: { event: string }) => events.push(obj)) as never);
    expect((await kindle.opds()).statusCode).toBe(401);
    expect(events.map((e) => e.event)).toEqual(["app_password.blocked_account"]);

    const deleted = await signUp();
    const nook = await device(deleted);
    expect((await nook.opds()).statusCode).toBe(200);
    expect((await api(admin, "DELETE", `/api/admin/users/${deleted.id}`)).statusCode).toBe(204);
    expect((await nook.opds()).statusCode).toBe(401);
  });
});

describe("HTTP caching of JSON answers", () => {
  it("answers 304 when the app already has the answer", async () => {
    const u = await signUp();
    const first = await api(u, "GET", "/api/me");
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/".+"$/);
    expect(first.headers["cache-control"]).toBe("private, no-cache");

    const again = await get("/api/me", { cookie: u.cookie, "if-none-match": etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
    expect(again.headers.etag).toBe(etag);
    expect(again.headers["content-type"]).toBeUndefined();
    expect((await get("/api/me", { cookie: u.cookie, "if-none-match": `"other", ${etag.slice(2)}` })).statusCode).toBe(304);

    // Changed: the new answer, with another ETag.
    await upload(u, "e.pdf", fakePdf());
    const changed = await get("/api/me", { cookie: u.cookie, "if-none-match": etag });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it("keeps routes' own caching and leaves sign-in, events, files and feeds alone", async () => {
    const u = await signUp();
    const cfg = await api(null, "GET", "/api/config");
    expect(cfg.headers["cache-control"]).toBe("public, max-age=300");
    expect(cfg.headers.etag).toMatch(/^W\//);

    const session = await api(u, "GET", "/api/auth/get-session");
    expect(session.statusCode).toBe(200);
    expect(session.headers.etag).toBeUndefined();
    expect((await api(u, "POST", "/api/folders", { name: "No ETag" })).headers.etag).toBeUndefined();

    const book = (await upload(u, "f.pdf", fakePdf())).json();
    expect((await api(u, "GET", `/api/books/${book.id}/file`)).headers.etag).toMatch(/^"[0-9a-f]{64}"$/); // the file's own

    const { password } = (await api(u, "POST", "/api/app-passwords", { name: "Kobo" })).json();
    const feed = await get("/opds/library", { authorization: `Basic ${Buffer.from(`${u.email}:${password}`).toString("base64")}` });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers.etag).toBeUndefined();

    // The event stream never ends: read its headers from a real connection, then hang up.
    const server = await buildServer();
    try {
      await server.listen({ port: 0, host: "127.0.0.1" });
      const { port } = server.server.address() as AddressInfo;
      const hangUp = new AbortController();
      const events = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { origin: ORIGIN, cookie: u.cookie }, signal: hangUp.signal });
      expect(events.headers.get("content-type")).toMatch(/^text\/event-stream/);
      expect(events.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect(events.headers.get("etag")).toBeNull();
      hangUp.abort();
    } finally {
      await server.close();
    }
  });
});

describe("public catalog cache", () => {
  const listed = async (u: TestUser) => (await api(u, "GET", "/api/public")).json() as { id: string; title: string; ownBookId: string | null }[];

  it("reads the catalog once for everyone, and again when the public library changes", async () => {
    const owner = await signUp(undefined, "Publisher");
    const readers = [await signUp(), await signUp(), await signUp()];
    const book = (await upload(owner, "p.pdf", fakePdf(), { title: "Cached catalog" })).json();
    await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true });

    const sql = watchQueries();
    const lists = await Promise.all(readers.map((r) => api(r, "GET", "/api/public")));
    expect(lists.every((l) => l.statusCode === 200)).toBe(true);
    await listed(readers[0]!);
    expect(sql().filter((s) => s.includes("WITH pick AS"))).toHaveLength(1);

    // Same answer as before the cache: every field, in the same order, per viewer.
    const entry = lists[0]!.json().find((b: { id: string }) => b.id === book.id);
    expect(Object.keys(entry)).toEqual([
      "id", "title", "author", "format", "filename", "sizeBytes", "hasCover", "language", "source", "themes",
      "popularity", "publishedBy", "publishedAt", "ownBookId", "isMine", "canRemove",
    ]);
    expect(entry).toMatchObject({ title: "Cached catalog", publishedBy: "Publisher", ownBookId: null, isMine: false, canRemove: false });
    expect((await listed(owner)).find((b) => b.id === book.id)).toMatchObject({ ownBookId: book.id, isMine: true, canRemove: true });

    // A copy added by a reader shows at once (it is per viewer, not cached).
    const copy = (await api(readers[0]!, "POST", `/api/public/${book.id}/add`)).json();
    expect((await listed(readers[0]!)).find((b) => b.id === book.id)!.ownBookId).toBe(copy.id);

    // Renaming a public book or unpublishing it reaches the catalog at once.
    await api(owner, "PATCH", `/api/books/${book.id}`, { title: "Renamed" });
    expect((await listed(readers[1]!)).find((b) => b.id === book.id)!.title).toBe("Renamed");
    await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: false });
    expect((await listed(readers[1]!)).some((b) => b.id === book.id)).toBe(false);
  });

  it("expires within 5 minutes for changes nobody broadcasts (the import script)", async () => {
    const owner = await signUp();
    const reader = await signUp();
    const book = (await upload(owner, "q.pdf", fakePdf(), { title: "Before" })).json();
    await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true });
    expect((await listed(reader)).find((b) => b.id === book.id)!.title).toBe("Before");

    await query("UPDATE book SET title = 'After' WHERE id = $1", [book.id]);
    expect((await listed(reader)).find((b) => b.id === book.id)!.title).toBe("Before");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1);
    expect((await listed(reader)).find((b) => b.id === book.id)!.title).toBe("After");
  });
});

describe("cover types", () => {
  it("sniffs a cover's type once, and forgets it with the cover", async () => {
    const u = await signUp();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const book = (await upload(u, "c.pdf", fakePdf(), {}, png)).json();
    expect((await api(u, "GET", `/api/books/${book.id}/cover`)).headers["content-type"]).toBe("image/png");

    // Rewritten behind the app's back (stored objects never change): the type isn't read again.
    await fs.writeFile(path.join(config.storageDir, ...coverKey(book.id).split("/")), Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(70)]));
    expect((await api(u, "GET", `/api/books/${book.id}/cover`)).headers["content-type"]).toBe("image/png");

    await removeCover(book.id);
    expect((await api(u, "GET", `/api/books/${book.id}/cover`)).json().error).toBe("no_cover");
  });
});

describe("book club progress", () => {
  /** The live events `user` receives from now on. */
  function events(user: TestUser) {
    const got: string[] = [];
    subscribe(user.id, { raw: { write: (frame: string) => got.push(frame.split("\n")[0]!.slice(7)) } } as unknown as FastifyReply);
    return got;
  }
  const read = (u: TestUser, bookId: string, page: number) =>
    api(u, "PUT", `/api/books/${bookId}/progress`, { locator: `page:${page}`, percentage: page / 100, deviceId: "d", clientUpdatedAt: Date.now() });

  it("skips the club lookup for readers in no club, and notices when they join or leave", async () => {
    const owner = await signUp();
    const friend = await signUp();
    const book = (await upload(owner, "club.pdf", fakePdf())).json();
    const club = (await api(owner, "POST", "/api/clubs", { bookId: book.id, name: "Cache club" })).json();
    // The friend has the book and reads it before joining: no club yet (and that is remembered).
    const own = (await api(friend, "POST", `/api/clubs/invite/${club.inviteToken}/join`)).json();
    expect((await api(friend, "DELETE", `/api/clubs/${club.id}/members/me`)).statusCode).toBe(204);
    const sql = watchQueries();
    await read(friend, own.bookId, 1);
    await read(friend, own.bookId, 2);
    expect(sql().filter((s) => s.includes("FROM club_member WHERE user_id"))).toHaveLength(1);
    expect(sql().filter((s) => s.includes("JOIN club_member x"))).toHaveLength(0);

    const ownerEvents = events(owner);
    await api(friend, "POST", `/api/clubs/invite/${club.inviteToken}/join`);
    await read(friend, own.bookId, 3);
    expect(ownerEvents.filter((e) => e === "club.progress")).toHaveLength(1);

    await api(friend, "DELETE", `/api/clubs/${club.id}/members/me`);
    await read(friend, own.bookId, 4);
    expect(ownerEvents.filter((e) => e === "club.progress")).toHaveLength(1);
  });
});

describe("dictionary cache", () => {
  /** Fakes Wiktionary (404 for every word but `known`) and MyMemory; counts the requests per word. */
  function fakeProviders(myMemory: (q: string) => object) {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.mymemory.translated.net") {
        calls.push(`mymemory:${url.searchParams.get("q")}`);
        return Response.json(myMemory(url.searchParams.get("q")!));
      }
      const word = decodeURIComponent(url.pathname.split("/").pop()!);
      calls.push(word);
      return word.startsWith("known")
        ? Response.json({ en: [{ partOfSpeech: "Noun", language: "English", definitions: [{ definition: "a <b>word</b>" }] }] })
        : new Response("{}", { status: 404 });
    });
    return calls;
  }

  it("keeps the most recently used words", async () => {
    const calls = fakeProviders(() => ({}));
    expect(await define("knownkept", "en")).toMatchObject({ entries: [{ definitions: ["a word"] }] });
    await define("knowndropped", "en");
    for (let i = 0; i < 2100; i++) {
      await define(`filler${i}`, null);
      if (i % 100 === 0) await define("knownkept", "en"); // used again: stays
    }
    expect(calls.filter((c) => c === "knownkept")).toHaveLength(1);
    await define("knowndropped", "en"); // the least recently used went first
    expect(calls.filter((c) => c === "knowndropped")).toHaveLength(2);
  });

  it("remembers that a passage already is in the target language", async () => {
    const calls = fakeProviders(() => ({ responseStatus: 403, responseDetails: "PLEASE SELECT TWO DISTINCT LANGUAGES", responseData: { translatedText: "" } }));
    const u = await signUp();
    for (let i = 0; i < 2; i++) {
      const res = await api(u, "POST", "/api/translate", { text: "already english", from: "en", to: "en-GB" });
      expect(res.json()).toMatchObject({ text: "already english", sameLanguage: true });
    }
    expect(calls.filter((c) => c.startsWith("mymemory:"))).toHaveLength(1);
  });

  it("lets the browser keep complete answers for a day", async () => {
    fakeProviders((q) => (q === "knownword" ? { responseStatus: 200, responseData: { translatedText: "palavra" } } : { responseStatus: 403, responseData: { translatedText: "" } }));
    const u = await signUp();
    const full = await api(u, "GET", "/api/dictionary/word?word=knownword&to=pt&from=en");
    expect(full.json()).toMatchObject({ translation: "palavra", entries: [{ definitions: ["a word"] }] });
    expect(full.headers["cache-control"]).toBe("private, max-age=86400");
    expect((await api(u, "GET", "/api/dictionary?word=knownword")).headers["cache-control"]).toBe("private, max-age=86400");

    // The translation failed: worth asking again.
    const partial = await api(u, "GET", "/api/dictionary/word?word=knownother&to=pt&from=en");
    expect(partial.json()).toMatchObject({ translation: null, entries: [{ definitions: ["a word"] }] });
    expect(partial.headers["cache-control"]).toBe("private, no-cache");

    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("down", { status: 500 }));
    const down = await api(u, "GET", "/api/dictionary?word=unreachable");
    expect(down.statusCode).toBe(503);
    expect(down.headers["cache-control"]).toBeUndefined();
  });
});
