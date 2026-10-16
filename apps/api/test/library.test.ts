import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/lib/formats.js";
import { adminSession, api, fakePdf, getApp, signUp, upload } from "./helpers.js";

describe("format detection", () => {
  it("uses magic bytes, not just the extension", () => {
    expect(detectFormat(Buffer.from("%PDF-1.7"), "x.epub")).toBe("pdf");
    expect(detectFormat(Buffer.from("Rar!\x1a\x07\x01\x00", "latin1"), "c.cbr")).toBe("cbr");
    expect(detectFormat(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "c.cb7")).toBe("cb7");
    const tar = Buffer.alloc(512);
    tar.write("ustar", 257, "latin1");
    expect(detectFormat(tar, "c.cbt")).toBe("cbt");
    expect(detectFormat(Buffer.from("hello"), "x.pdf")).toBeNull();
  });
});

describe("library", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await api(null, "GET", "/api/books")).statusCode).toBe(401);
  });

  it("uploads, detects duplicates, edits and deletes a book", async () => {
    const u = await signUp();
    const file = fakePdf();
    const first = await upload(u, "My Book.pdf", file, { title: "My Book", author: "Someone" });
    expect(first.statusCode).toBe(201);
    const book = first.json();
    expect(book).toMatchObject({ title: "My Book", author: "Someone", format: "pdf", favorite: false, isPublic: false });

    expect((await upload(u, "again.pdf", file)).statusCode).toBe(409);

    const edited = await api(u, "PATCH", `/api/books/${book.id}`, { tags: ["Fun", " fun ", "Work"], favorite: true });
    expect(edited.json()).toMatchObject({ tags: ["Fun", "Work"], favorite: true });

    const other = await signUp();
    expect((await api(other, "GET", `/api/books/${book.id}`)).statusCode).toBe(404);

    expect((await api(u, "DELETE", `/api/books/${book.id}`)).statusCode).toBe(204);
    expect((await api(u, "GET", "/api/books")).json()).toHaveLength(0);
  });

  it("uploads straight into a collection", async () => {
    const u = await signUp();
    const other = await signUp();
    const folder = (await api(u, "POST", "/api/folders", { name: "Comics" })).json();
    const res = await upload(u, "c.pdf", fakePdf(), { folderId: folder.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().folderId).toBe(folder.id);
    // Someone else's collection, or nonsense, is refused.
    expect((await upload(other, "d.pdf", fakePdf(), { folderId: folder.id })).statusCode).toBe(400);
    expect((await upload(u, "e.pdf", fakePdf(), { folderId: "nope" })).statusCode).toBe(400);
  });

  it("enforces the storage quota, except for administrators", async () => {
    const u = await signUp();
    expect((await upload(u, "a.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
    const over = await upload(u, "b.pdf", fakePdf(600 * 1024)); // 1.2 MB > 1 MB quota
    expect(over.statusCode).toBe(413);
    expect(over.json().error).toBe("quota_exceeded");
    expect((await api(u, "GET", "/api/me")).json()).toMatchObject({ isAdmin: false, quotaBytes: 1024 * 1024 });

    const admin = await adminSession();
    const before = (await api(admin, "GET", "/api/me")).json().usedBytes;
    expect((await upload(admin, "a.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
    expect((await upload(admin, "b.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
    expect((await api(admin, "GET", "/api/me")).json().usedBytes - before).toBeGreaterThan(1024 * 1024);
    expect((await api(admin, "GET", "/api/me")).json()).toMatchObject({ isAdmin: true, quotaBytes: null });
  });
});

describe("sharing and the public library", () => {
  it("shares by link and publishes for everyone", async () => {
    const owner = await signUp(undefined, "Owner");
    const reader = await signUp();
    const book = (await upload(owner, "s.pdf", fakePdf(), { title: "Shared" })).json();

    const { token } = (await api(owner, "POST", `/api/books/${book.id}/share`)).json();
    expect((await api(reader, "GET", `/api/shares/${token}`)).json()).toMatchObject({ title: "Shared", sharedBy: "Owner" });
    const copy = await api(reader, "POST", `/api/shares/${token}/accept`);
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ sharedBy: "Owner" });
    expect((await api(reader, "POST", `/api/shares/${token}/accept`)).statusCode).toBe(200); // idempotent

    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true })).json().isPublic).toBe(true);
    const stranger = await signUp();
    const list = (await api(stranger, "GET", "/api/public")).json();
    expect(list.map((b: { id: string }) => b.id)).toContain(book.id);
    expect((await api(stranger, "GET", `/api/public/${book.id}/file`)).headers["content-disposition"]).toMatch(/^attachment/);
    expect((await api(stranger, "DELETE", `/api/public/${book.id}`)).statusCode).toBe(403);

    expect((await api(owner, "DELETE", `/api/public/${book.id}`)).statusCode).toBe(204);
    expect((await api(stranger, "GET", "/api/public")).json().map((b: { id: string }) => b.id)).not.toContain(book.id);
  });

  it("lists a file published by several people once, as its earliest publication, newest first", async () => {
    const owner = await signUp(undefined, "Owner");
    const reader = await signUp();
    const file = fakePdf();
    const first = (await upload(owner, "same.pdf", file, { title: "Same file" })).json();
    const second = (await upload(reader, "same.pdf", file, { title: "Same file" })).json();
    const other = (await upload(reader, "other.pdf", fakePdf(), { title: "Other file" })).json();
    for (const [u, b] of [[owner, first], [reader, second], [reader, other]] as const) {
      expect((await api(u, "PATCH", `/api/books/${b.id}`, { isPublic: true })).statusCode).toBe(200);
    }

    const ours = (list: { id: string }[]) => list.filter((b) => [first.id, second.id, other.id].includes(b.id));
    const seenByReader = ours((await api(reader, "GET", "/api/public")).json());
    expect(seenByReader).toMatchObject([
      { id: other.id, ownBookId: other.id, isMine: true },
      { id: first.id, ownBookId: second.id, isMine: false, publishedBy: "Owner" },
    ]);
    expect(ours((await api(owner, "GET", "/api/public")).json())).toMatchObject([
      { id: other.id, ownBookId: null, isMine: false },
      { id: first.id, ownBookId: first.id, isMine: true },
    ]);

    // The OPDS public feed lists the same entries.
    const { password } = (await api(reader, "POST", "/api/app-passwords", { name: "Kobo" })).json();
    const feed = await (await getApp()).inject({
      method: "GET",
      url: "/opds/public",
      headers: { authorization: `Basic ${Buffer.from(`${reader.email}:${password}`).toString("base64")}` },
    });
    const ids = [...feed.body.matchAll(/urn:uuid:([0-9a-f-]{36})/g)].map((m) => m[1]);
    expect(ids.filter((id) => [first.id, second.id, other.id].includes(id!))).toEqual([other.id, first.id]);
  });

  it("keeps the description and tells a book's page about other readers and the public entry", async () => {
    const owner = await signUp(undefined, "Owner");
    const reader = await signUp();
    const long = "x".repeat(5000);
    const book = (await upload(owner, "d.pdf", fakePdf(), { title: "Described", description: `  A quiet story.  ` })).json();
    expect(book.description).toBe("A quiet story.");
    expect((await upload(owner, "f.pdf", fakePdf(), { description: "One.\r\n\r\nTwo." })).json().description).toBe("One.\n\nTwo.");
    expect((await upload(owner, "e.pdf", fakePdf(), { description: long })).json().description).toHaveLength(4000);

    expect((await api(owner, "GET", `/api/books/${book.id}/about`)).json()).toEqual({ readers: 0, publicBookId: null, source: null, subjects: [] });
    expect((await api(reader, "GET", `/api/books/${book.id}/about`)).statusCode).toBe(404);

    await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true });
    const page = (await api(reader, "GET", `/api/public/${book.id}`)).json();
    expect(page).toMatchObject({ title: "Described", description: "A quiet story.", publishedBy: "Owner", readers: 1, ownBookId: null });

    // A copy keeps the blurb, and each side now sees one other reader.
    const copy = (await api(reader, "POST", `/api/public/${book.id}/add`)).json();
    expect(copy.description).toBe("A quiet story.");
    expect((await api(reader, "GET", `/api/books/${copy.id}/about`)).json()).toMatchObject({ readers: 1, publicBookId: book.id });
    expect((await api(owner, "GET", `/api/books/${book.id}/about`)).json().readers).toBe(1);
    expect((await api(reader, "GET", `/api/public/${book.id}`)).json()).toMatchObject({ readers: 2, ownBookId: copy.id });

    await api(owner, "DELETE", `/api/public/${book.id}`);
    expect((await api(reader, "GET", `/api/public/${book.id}`)).statusCode).toBe(404);
  });

  it("shares a whole collection by link", async () => {
    const owner = await signUp(undefined, "Owner");
    const reader = await signUp();
    const folder = (await api(owner, "POST", "/api/folders", { name: "Mysteries" })).json();
    const a = (await upload(owner, "a.pdf", fakePdf(), { title: "A" })).json();
    const b = (await upload(owner, "b.pdf", fakePdf(), { title: "B" })).json();
    await api(owner, "PATCH", `/api/books/${a.id}`, { folderId: folder.id });

    expect((await api(reader, "POST", `/api/folders/${folder.id}/share`)).statusCode).toBe(404);
    const { token } = (await api(owner, "POST", `/api/folders/${folder.id}/share`)).json();
    expect((await api(owner, "GET", `/api/folders/${folder.id}/share`)).json().token).toBe(token);

    const preview = (await api(reader, "GET", `/api/collection-shares/${token}`)).json();
    expect(preview).toMatchObject({ name: "Mysteries", sharedBy: "Owner", isOwner: false });
    expect(preview.books.map((x: { title: string }) => x.title)).toEqual(["A"]);

    const first = await api(reader, "POST", `/api/collection-shares/${token}/accept`);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ added: 1 });
    const mine = (await api(reader, "GET", "/api/books")).json();
    expect(mine).toEqual([expect.objectContaining({ title: "A", folderId: first.json().folderId, sharedBy: "Owner" })]);

    // Books added to the collection later reach the link; accepting again adds only those.
    await api(owner, "PATCH", `/api/books/${b.id}`, { folderId: folder.id });
    const again = await api(reader, "POST", `/api/collection-shares/${token}/accept`);
    expect(again.json()).toMatchObject({ added: 1, folderId: first.json().folderId });
    expect((await api(reader, "GET", "/api/books")).json()).toHaveLength(2);
    expect((await api(reader, "POST", `/api/collection-shares/${token}/accept`)).statusCode).toBe(200);
    expect((await api(owner, "POST", `/api/collection-shares/${token}/accept`)).statusCode).toBe(409);

    expect((await api(owner, "DELETE", `/api/folders/${folder.id}/share`)).statusCode).toBe(204);
    expect((await api(reader, "GET", `/api/collection-shares/${token}`)).statusCode).toBe(404);
  });
});
