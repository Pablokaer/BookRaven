import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool, query } from "../src/db.js";
import { onBroadcast, subscribe } from "../src/lib/events.js";
import { ensureLibraryAccount, storePublicBook } from "../src/lib/gutenbergImport.js";
import { BlockedFileError } from "../src/lib/moderation.js";
import { catalogTransaction, publishBook } from "../src/lib/publicCatalog.js";
import { bookKey, objectSize, streamToTemp } from "../src/lib/storage.js";
import { adminSession, api, fakePdf, getApp, signUp, upload, type TestUser } from "./helpers.js";

/** `public.changed` broadcasts, and what one account's live stream receives. */
const broadcasts: unknown[] = [];
onBroadcast("public.changed", () => broadcasts.push(true));

function listen(user: { id: string }) {
  const frames: { event: string; data: any }[] = [];
  const reply = {
    raw: {
      write(s: string) {
        const m = /^event: (.+)\ndata: (.*)\n\n$/s.exec(s);
        if (m) frames.push({ event: m[1]!, data: JSON.parse(m[2]!) });
      },
    },
  } as unknown as FastifyReply;
  return { frames, stop: subscribe(user.id, reply) };
}

let stops: (() => void)[] = [];
beforeEach(() => {
  broadcasts.length = 0;
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
});
const watch = (user: { id: string }) => {
  const l = listen(user);
  stops.push(l.stop);
  return l.frames;
};

const sha = (file: Buffer) => createHash("sha256").update(file).digest("hex");
const block = (file: Buffer) => query("INSERT INTO blocked_file (sha256, title, reason) VALUES ($1, 'x', 'test') ON CONFLICT DO NOTHING", [sha(file)]);

async function publicIds(user: TestUser) {
  return ((await api(user, "GET", "/api/public")).json() as { id: string }[]).map((b) => b.id);
}

async function opdsIds(user: TestUser) {
  const { password } = (await api(user, "POST", "/api/app-passwords", { name: "Kobo" })).json();
  const feed = await (await getApp()).inject({
    method: "GET",
    url: "/opds/public",
    headers: { authorization: `Basic ${Buffer.from(`${user.email}:${password}`).toString("base64")}` },
  });
  return [...feed.body.matchAll(/urn:uuid:([0-9a-f-]{36})/g)].map((m) => m[1]!);
}

describe("public catalog", () => {
  it("publishes from a book's settings: listed, owner told, everyone told", async () => {
    const owner = await signUp();
    const reader = await signUp();
    const book = (await upload(owner, "p.pdf", fakePdf(), { title: "Published" })).json();
    const frames = watch(owner);

    const res = await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true, title: "Renamed" });
    expect(res.json()).toMatchObject({ isPublic: true, title: "Renamed" });
    expect(await publicIds(reader)).toContain(book.id);
    expect(await opdsIds(reader)).toContain(book.id);
    expect(broadcasts).toHaveLength(1);
    // One book.updated, with the edits made in the same request.
    expect(frames.filter((f) => f.event === "book.updated")).toEqual([{ event: "book.updated", data: res.json() }]);
    expect(frames.find((f) => f.event === "public.changed")!.data).toEqual({ bookId: book.id });

    // Publishing again changes nothing; editing a public book's title still refreshes the catalog.
    broadcasts.length = 0;
    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true })).statusCode).toBe(200);
    expect(broadcasts).toHaveLength(0);
    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { title: "Again" })).statusCode).toBe(200);
    expect(broadcasts).toHaveLength(1);
    expect(((await api(reader, "GET", "/api/public")).json() as { id: string; title: string }[]).find((b) => b.id === book.id)!.title).toBe("Again");

    // Unpublishing takes it out of both catalogs.
    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: false })).json().isPublic).toBe(false);
    expect(await publicIds(reader)).not.toContain(book.id);
    expect(await opdsIds(reader)).not.toContain(book.id);
  });

  it("publishes a book that answers a request", async () => {
    const asker = await signUp();
    const helper = await signUp();
    const book = (await upload(helper, "r.pdf", fakePdf(), { title: "Requested" })).json();
    const req = (await api(asker, "POST", "/api/requests", { title: "Requested" })).json();
    const frames = watch(helper);
    expect((await api(helper, "POST", `/api/requests/${req.id}/fulfill`, { bookId: book.id })).statusCode).toBe(204);
    expect(await publicIds(asker)).toContain(book.id);
    expect(broadcasts).toHaveLength(1);
    expect(frames.find((f) => f.event === "book.updated")!.data).toMatchObject({ id: book.id, isPublic: true });
  });

  it("lists an imported public-domain book", async () => {
    const reader = await signUp();
    const owner = await ensureLibraryAccount();
    const file = await streamToTemp(Readable.from(randomBytes(4096)));
    const meta = {
      source: "gutenberg",
      sourceId: `t${randomBytes(4).toString("hex")}`,
      sourceUrl: "https://www.gutenberg.org/ebooks/1",
      title: "An Imported Book",
      authors: [{ name: "Author, Some", birth_year: 1800, death_year: 1850 }],
      translators: [],
      language: "en",
      subjects: [],
      themes: [],
      tags: [],
      description: null,
      popularity: 7,
    };
    await storePublicBook(owner, file, meta, [], fetch);
    expect(broadcasts).toHaveLength(1);
    const listed = ((await api(reader, "GET", "/api/public")).json() as { id: string; title: string; popularity: number }[]).find(
      (b) => b.title === "An Imported Book",
    )!;
    expect(listed).toMatchObject({ popularity: 7, source: { url: "https://www.gutenberg.org/ebooks/1" } });
    expect(await opdsIds(reader)).toContain(listed.id);

    // An administrator takes it out; importing it again does not put it back.
    const admin = await adminSession();
    expect((await api(admin, "DELETE", `/api/public/${listed.id}`)).statusCode).toBe(204);
    await storePublicBook(owner, file, { ...meta, popularity: 8 }, [], fetch);
    expect(await publicIds(reader)).not.toContain(listed.id);
  });

  it("refuses a blocked file on every path", async () => {
    const owner = await signUp();
    const file = fakePdf();
    const book = (await upload(owner, "b.pdf", file, { title: "Blocked" })).json();
    await block(file);

    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true, title: "Not saved" })).statusCode).toBe(451);
    expect((await api(owner, "GET", `/api/books/${book.id}`)).json()).toMatchObject({ isPublic: false, title: "Blocked" });

    const asker = await signUp();
    const req = (await api(asker, "POST", "/api/requests", { title: "Blocked" })).json();
    expect((await api(owner, "POST", `/api/requests/${req.id}/fulfill`, { bookId: book.id })).statusCode).toBe(451);

    await expect(publishBook({ id: book.id, user_id: owner.id, sha256: sha(file) })).rejects.toBeInstanceOf(BlockedFileError);

    const libraryOwner = await ensureLibraryAccount();
    const blockedImport = await streamToTemp(Readable.from(randomBytes(2048)));
    await query("INSERT INTO blocked_file (sha256, title, reason) VALUES ($1, 'x', 'test')", [blockedImport.sha256]);
    const meta = {
      source: "gutenberg",
      sourceId: `t${randomBytes(4).toString("hex")}`,
      sourceUrl: "https://www.gutenberg.org/ebooks/2",
      title: "A Blocked Import",
      authors: [],
      translators: [],
      language: "en",
      subjects: [],
      themes: [],
      tags: [],
      description: null,
      popularity: 1,
    };
    await expect(storePublicBook(libraryOwner, blockedImport, meta, [], fetch)).rejects.toBeInstanceOf(BlockedFileError);
    expect((await query("SELECT 1 FROM book WHERE sha256 = $1", [blockedImport.sha256])).rowCount).toBe(0);

    expect(broadcasts).toHaveLength(0);
    expect(await publicIds(owner)).not.toContain(book.id);
  });

  it("unpublishes through the public library and moderation", async () => {
    const owner = await signUp();
    const other = await signUp();
    const reader = await signUp();
    const file = fakePdf();
    const mine = (await upload(owner, "m.pdf", file, { title: "Mine" })).json();
    const theirs = (await upload(other, "m.pdf", file, { title: "Mine too" })).json();
    for (const [u, b] of [[owner, mine], [other, theirs]] as const) await api(u, "PATCH", `/api/books/${b.id}`, { isPublic: true });

    // The publisher takes theirs out: the file is still listed, as the other publication.
    expect((await api(owner, "DELETE", `/api/public/${mine.id}`)).statusCode).toBe(204);
    expect(await publicIds(reader)).not.toContain(mine.id);
    expect(await publicIds(reader)).toContain(theirs.id);

    // An administrator takes the file out after a report: every publication goes, each owner is told.
    await api(owner, "PATCH", `/api/books/${mine.id}`, { isPublic: true });
    expect((await api(reader, "POST", `/api/public/${theirs.id}/report`, { reason: "spam" })).statusCode).toBe(201);
    const admin = await adminSession();
    const report = ((await api(admin, "GET", "/api/admin/reports")).json() as { id: string; sha256: string }[]).find((r) => r.sha256 === sha(file))!;
    const ownerFrames = watch(owner);
    const otherFrames = watch(other);
    broadcasts.length = 0;
    expect((await api(admin, "POST", `/api/admin/reports/${report.id}/resolve`, { action: "unpublish" })).statusCode).toBe(200);
    expect(broadcasts).toHaveLength(1);
    expect(ownerFrames.find((f) => f.event === "book.updated")!.data).toMatchObject({ id: mine.id, isPublic: false });
    expect(otherFrames.find((f) => f.event === "book.updated")!.data).toMatchObject({ id: theirs.id, isPublic: false });
    expect(ownerFrames.find((f) => f.event === "public.changed")!.data).toEqual({ sha256: sha(file) });
    const ids = await publicIds(reader);
    expect(ids).not.toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("lists the same books on the web and in OPDS: a file once, as its earliest publication", async () => {
    const a = await signUp();
    const b = await signUp();
    const file = fakePdf();
    const first = (await upload(a, "s.pdf", file, { title: "Shared file" })).json();
    const second = (await upload(b, "s.pdf", file, { title: "Shared file" })).json();
    const newest = (await upload(b, "n.pdf", fakePdf(), { title: "Newest" })).json();
    for (const [u, book] of [[a, first], [b, second], [b, newest]] as const) await api(u, "PATCH", `/api/books/${book.id}`, { isPublic: true });

    const ours = (ids: string[]) => ids.filter((id) => [first.id, second.id, newest.id].includes(id));
    expect(ours(await publicIds(a))).toEqual([newest.id, first.id]);
    expect(ours(await opdsIds(a))).toEqual([newest.id, first.id]);
    // The whole first page matches.
    const web = await publicIds(a);
    expect((await opdsIds(a))).toEqual(web.slice(0, 50));
  });

  it("commits catalog changes with the caller's transaction, and tells no one when it rolls back", async () => {
    const owner = await signUp();
    const book = (await upload(owner, "t.pdf", fakePdf(), { title: "Rolled back" })).json();
    const frames = watch(owner);
    await expect(
      catalogTransaction(async (catalog, db) => {
        await catalog.publish({ id: book.id, user_id: owner.id, sha256: (await query("SELECT sha256 FROM book WHERE id = $1", [book.id])).rows[0].sha256 });
        await db.query("UPDATE book SET title = 'Changed' WHERE id = $1", [book.id]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await api(owner, "GET", `/api/books/${book.id}`)).json()).toMatchObject({ isPublic: false, title: "Rolled back" });
    expect(await publicIds(owner)).not.toContain(book.id);
    expect(broadcasts).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it("publishes with the transaction's own connection, so concurrent publishes can't exhaust the pool", async () => {
    const owner = await signUp();
    const max = pool.options.max!;
    const books: { id: string; sha256: string }[] = [];
    for (let i = 0; i < max; i++) {
      const file = fakePdf();
      books.push({ ...(await upload(owner, `c${i}.pdf`, file, { title: `Concurrent ${i}` })).json(), sha256: sha(file) });
    }
    // Every connection of the pool is held by a transaction before any of them publishes.
    let entered = 0;
    let allIn!: () => void;
    const barrier = new Promise<void>((resolve) => (allIn = resolve));
    const results = await Promise.all(
      books.map((b) =>
        catalogTransaction(async (catalog) => {
          if (++entered === max) allIn();
          await barrier;
          return catalog.publish({ id: b.id, user_id: owner.id, sha256: b.sha256 });
        }),
      ),
    );
    expect(results.map((r) => r.value)).toEqual(books.map(() => true));
    const ids = await publicIds(owner);
    for (const b of books) expect(ids).toContain(b.id);
  });

  it("reads a changed book once, and answers even when telling its owner fails", async () => {
    const owner = await signUp();
    const book = (await upload(owner, "f.pdf", fakePdf(), { title: "Told" })).json();
    const frames = watch(owner);
    const real = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    const reads: string[] = [];
    const spy = vi.spyOn(pool, "query").mockImplementation(((text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string" && text.includes("reading_progress")) reads.push(text);
      return real(text, ...rest);
    }) as never);
    try {
      // The owner's own read (loadOwnedBook) and the catalog's after commit: no third for the answer.
      const res = await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true, title: "Told twice" });
      expect(res.json()).toMatchObject({ isPublic: true, title: "Told twice" });
      expect(reads).toHaveLength(2);
      expect(frames.filter((f) => f.event === "book.updated")).toEqual([{ event: "book.updated", data: res.json() }]);

      // The read after commit fails: the change stands, everyone still hears of it, the request answers.
      spy.mockImplementation(((text: unknown, ...rest: unknown[]) =>
        typeof text === "string" && text.includes("b.id = ANY($1)") ? Promise.reject(new Error("read failed")) : real(text, ...rest)) as never);
      broadcasts.length = 0;
      frames.length = 0;
      const off = await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: false });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ isPublic: false });
      expect(broadcasts).toHaveLength(1);
      expect(frames.find((f) => f.event === "book.updated")!.data).toMatchObject({ id: book.id, isPublic: false });
      await expect(publishBook({ id: book.id, user_id: owner.id, sha256: (await query("SELECT sha256 FROM book WHERE id = $1", [book.id])).rows[0].sha256 })).resolves.toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(await publicIds(owner)).toContain(book.id);
  });

  it("leaves no files behind when an import is not added", async () => {
    const owner = await ensureLibraryAccount();
    const file = await streamToTemp(Readable.from(randomBytes(2048)));
    await query("INSERT INTO blocked_file (sha256, title, reason) VALUES ($1, 'x', 'test')", [file.sha256]);
    const covers = path.join(process.env.STORAGE_DIR!, "covers");
    const coverFiles = () => fs.readdir(covers).catch(() => [] as string[]);
    const before = await coverFiles();
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(512)]);
    const get = (async () => new Response(jpeg)) as unknown as typeof fetch;
    const meta = {
      source: "gutenberg",
      sourceId: `t${randomBytes(4).toString("hex")}`,
      sourceUrl: "https://www.gutenberg.org/ebooks/3",
      title: "A Failed Import",
      authors: [],
      translators: [],
      language: "en",
      subjects: [],
      themes: [],
      tags: [],
      description: null,
      popularity: 1,
    };
    await expect(storePublicBook(owner, file, meta, ["https://example.com/cover.jpg"], get)).rejects.toBeInstanceOf(BlockedFileError);
    expect(await coverFiles()).toEqual(before);
    expect(await objectSize(bookKey(file.sha256))).toBeNull();
  });
});
