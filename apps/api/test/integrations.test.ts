import { createHash, randomBytes } from "node:crypto";
import SevenZip from "7z-wasm";
import { XMLValidator } from "fast-xml-parser";
import jpeg from "jpeg-js";
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

/** An OPDS feed, checked to be well-formed XML. */
async function opdsFeed(u: TestUser, password: string, url: string) {
  const res = await basic(u, password, url);
  expect(res.statusCode).toBe(200);
  expect(XMLValidator.validate(res.body)).toBe(true);
  return res.body;
}

/** The <entry> of a book in a feed. */
const entryOf = (feed: string, id: string) => feed.split("<entry>").find((e) => e.includes(`urn:uuid:${id}`)) ?? "";

/** A width × height JPEG in colour (a red to blue gradient). */
function colourJpeg(width: number, height: number) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([255 - ((i % width) * 255) / width, 40, ((i % width) * 255) / width, 255], i * 4);
  return jpeg.encode({ width, height, data }, 90).data;
}

describe("OPDS for e-readers", () => {
  it("lists what is being read, with progress, description, series and a readable file name", async () => {
    const u = await signUp();
    const { password } = await appPassword(u, "Kindle");
    const dune = (
      await upload(u, "dune_v2_FINAL.pdf", fakePdf(), {
        title: "Dune: Part <1>",
        author: "Frank Herbert",
        description: "A desert planet & its spice.\u0007",
        series: "Dune Chronicles",
        seriesIndex: "1",
        publisher: "Chilton Books",
        issued: "1965-08-01T00:00:00Z",
      })
    ).json();
    const unread = (await upload(u, "u.pdf", fakePdf(), { title: "Not started" })).json();
    const done = (await upload(u, "d.pdf", fakePdf(), { title: "All read" })).json();
    const put = (id: string, percentage: number, deviceName: string) =>
      api(u, "PUT", `/api/books/${id}/progress`, { locator: "page:2", percentage, deviceId: "k1", deviceName, clientUpdatedAt: Date.now() });
    await put(dune.id, 0.42, "Kindle");
    await put(done.id, 1, "Phone");

    const root = await opdsFeed(u, password, "/opds");
    expect(root).toContain('href="/opds/reading"');
    expect(root).toContain('href="/opds/finished"');

    const reading = await opdsFeed(u, password, "/opds/reading");
    expect(reading).toContain(`urn:uuid:${dune.id}`);
    expect(reading).not.toContain(`urn:uuid:${unread.id}`);
    expect(reading).not.toContain(`urn:uuid:${done.id}`);
    const entry = entryOf(reading, dune.id);
    expect(entry).toContain('<summary type="text">42% · read on Kindle just now · Series: Dune Chronicles #1</summary>');
    expect(entry).toContain('<content type="text">42% · read on Kindle just now\nSeries: Dune Chronicles #1\n\nA desert planet &amp; its spice.</content>');
    expect(entry).toContain("<calibre:series>Dune Chronicles</calibre:series>");
    expect(entry).toContain("<calibre:series_index>1</calibre:series_index>");
    expect(entry).toContain("<dc:publisher>Chilton Books</dc:publisher>");
    expect(entry).toContain("<dc:issued>1965-08-01</dc:issued>");

    const finished = await opdsFeed(u, password, "/opds/finished");
    expect(entryOf(finished, done.id)).toContain("Finished · read on Phone just now");
    expect(finished).not.toContain(`urn:uuid:${dune.id}`);
    expect(entryOf(await opdsFeed(u, password, "/opds/library"), unread.id)).not.toContain("<summary");
    expect(await opdsFeed(u, password, "/opds/search?q=chronicles")).toContain(`urn:uuid:${dune.id}`);

    const file = await basic(u, password, `/opds/books/${dune.id}/file`);
    expect(file.headers["content-disposition"]).toBe(
      "attachment; filename=\"Frank Herbert - Dune Part 1.pdf\"; filename*=UTF-8''Frank%20Herbert%20-%20Dune%20Part%201.pdf",
    );
    const accented = (await upload(u, "x.pdf", fakePdf(), { title: "Les Misérables", author: "Victor Hugo" })).json();
    expect((await basic(u, password, `/opds/books/${accented.id}/file`)).headers["content-disposition"]).toBe(
      "attachment; filename=\"Victor Hugo - Les Miserables.pdf\"; filename*=UTF-8''Victor%20Hugo%20-%20Les%20Mis%C3%A9rables.pdf",
    );
  });

  it("serves small grayscale thumbnails and the full cover", async () => {
    const u = await signUp();
    const { password } = await appPassword(u);
    const cover = colourJpeg(600, 900);
    const book = (await upload(u, "c.pdf", fakePdf(), { title: "Covered" }, cover)).json();
    const entry = entryOf(await opdsFeed(u, password, "/opds/library"), book.id);
    expect(entry).toContain(`rel="http://opds-spec.org/image" href="/opds/books/${book.id}/cover"`);
    expect(entry).toContain(`rel="http://opds-spec.org/image/thumbnail" href="/opds/books/${book.id}/thumbnail"`);

    expect((await basic(u, password, `/opds/books/${book.id}/cover`)).rawPayload.equals(cover)).toBe(true);
    const thumb = await basic(u, password, `/opds/books/${book.id}/thumbnail`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/jpeg");
    expect(thumb.headers["cache-control"]).toMatch(/immutable/);
    expect(thumb.rawPayload.length).toBeLessThan(cover.length / 2);
    const img = jpeg.decode(thumb.rawPayload, { useTArray: true });
    expect([img.width, img.height]).toEqual([200, 300]);
    for (let i = 0; i < img.data.length; i += 4 * 997) {
      expect(Math.abs(img.data[i]! - img.data[i + 1]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(img.data[i]! - img.data[i + 2]!)).toBeLessThanOrEqual(2);
    }
    const again = await (await getApp()).inject({
      method: "GET",
      url: `/opds/books/${book.id}/thumbnail`,
      headers: { authorization: `Basic ${Buffer.from(`${u.email}:${password}`).toString("base64")}`, "if-none-match": thumb.headers.etag as string },
    });
    expect(again.statusCode).toBe(304);
    expect((await basic(u, password, `/opds/books/${(await upload(u, "n.pdf", fakePdf())).json().id}/thumbnail`)).statusCode).toBe(404);
  });

  it("offers RAR/7z/TAR comics as CBZ too", async () => {
    const u = await signUp();
    const { password } = await appPassword(u);
    const sz = await SevenZip({ print: () => {}, printErr: () => {} });
    sz.FS.mkdir("/src");
    sz.FS.writeFile("/src/p1.jpg", randomBytes(30_000));
    sz.FS.chdir("/src");
    sz.callMain(["a", "-t7z", "/out.7z", "*"]);
    const comic = (await upload(u, "c.cb7", Buffer.from(sz.FS.readFile("/out.7z")), { title: "Comic", author: "Artist" })).json();
    const entry = entryOf(await opdsFeed(u, password, "/opds/library"), comic.id);
    expect(entry).toContain(`href="/opds/books/${comic.id}/file?as=cbz" type="application/vnd.comicbook+zip"`);
    expect(entry.indexOf("as=cbz")).toBeLessThan(entry.indexOf(`href="/opds/books/${comic.id}/file" type`)); // the CBZ first
    const cbz = await basic(u, password, `/opds/books/${comic.id}/file?as=cbz`);
    expect(cbz.statusCode).toBe(200);
    expect(cbz.headers["content-type"]).toBe("application/vnd.comicbook+zip");
    expect(cbz.headers["content-disposition"]).toContain('filename="Artist - Comic.cbz"');
    expect(cbz.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
    const pdf = (await upload(u, "p.pdf", fakePdf())).json();
    expect(entryOf(await opdsFeed(u, password, "/opds/library"), pdf.id)).not.toContain("as=cbz");
    expect((await basic(u, password, `/opds/books/${pdf.id}/file?as=cbz`)).statusCode).toBe(400);
  });

  it("browses the public library by section and theme", async () => {
    const owner = await signUp(undefined, "Owner");
    const reader = await signUp();
    const { password } = await appPassword(reader);
    const book = (await upload(owner, "m.pdf", fakePdf(), { title: "Meditations", description: "Notes to himself." })).json();
    expect((await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true, tags: ["Philosophy"] })).statusCode).toBe(200);

    const nav = await basic(reader, password, "/opds/public");
    expect(nav.headers["content-type"]).toMatch(/kind=navigation/);
    expect(XMLValidator.validate(nav.body)).toBe(true);
    for (const href of ["/opds/public/recent", "/opds/public/all", "/opds/public/readers", "/opds/public/themes/philosophy"]) {
      expect(nav.body).toContain(`href="${href}"`);
    }
    expect(await opdsFeed(reader, password, "/opds")).toMatch(/href="\/opds\/public" type="[^"]*kind=navigation"/);

    // Old saved "next page" links of the single public feed still list books.
    for (const url of ["/opds/public/recent", "/opds/public/themes/philosophy", "/opds/public/readers", "/opds/public?page=1"]) {
      expect(entryOf(await opdsFeed(reader, password, url), book.id)).toContain("Shared by Owner\n\nNotes to himself.");
    }
    expect(await opdsFeed(reader, password, "/opds/public/themes/poetry")).not.toContain(`urn:uuid:${book.id}`);
    expect((await basic(reader, password, "/opds/public/themes/cooking")).statusCode).toBe(404);
    await opdsFeed(reader, password, "/opds/public/all");
    await opdsFeed(reader, password, "/opds/public/popular");

    // The reader's progress shows once they have the book.
    const copy = (await api(reader, "POST", `/api/public/${book.id}/add`)).json();
    await api(reader, "PUT", `/api/books/${copy.id}/progress`, { locator: "page:1", percentage: 0.1, deviceId: "k", deviceName: "Kobo", clientUpdatedAt: Date.now() });
    expect(entryOf(await opdsFeed(reader, password, "/opds/public/recent"), book.id)).toContain("10% · read on Kobo just now");
    expect(await opdsFeed(reader, password, "/opds/reading")).toContain(`urn:uuid:${copy.id}`);
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
