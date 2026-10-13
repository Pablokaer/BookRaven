import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/lib/formats.js";
import { api, fakePdf, signUp, upload } from "./helpers.js";

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

  it("enforces the storage quota, except for administrators", async () => {
    const u = await signUp();
    expect((await upload(u, "a.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
    const over = await upload(u, "b.pdf", fakePdf(600 * 1024)); // 1.2 MB > 1 MB quota
    expect(over.statusCode).toBe(413);
    expect(over.json().error).toBe("quota_exceeded");
    expect((await api(u, "GET", "/api/me")).json()).toMatchObject({ isAdmin: false, quotaBytes: 1024 * 1024 });

    const admin = await signUp("admin@test.local");
    expect((await upload(admin, "a.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
    expect((await upload(admin, "b.pdf", fakePdf(600 * 1024))).statusCode).toBe(201);
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
    expect((await api(stranger, "GET", "/api/public")).json()).toHaveLength(0);
  });
});
