import type { FastifyReply } from "fastify";
import { describe, expect, it } from "vitest";
import { subscribe } from "../src/lib/events.js";
import { packageSpine } from "../src/lib/epubPositions.js";
import { partialMd5 } from "../src/lib/koreader.js";
import { cfiRange, cfiRangeEnds, cfiRangeToXpointers, parseXml, xpointerRangeToCfi, type EpubDocuments } from "../src/lib/xpointer.js";
import { CH1, CH2, CH3, fixtureEpub, OPF } from "./epubFixture.js";
import { api, fakePdf, getApp, signUp, upload, type TestUser } from "./helpers.js";

// The BookRaven KOReader plugin's API (routes/koreader.ts) and "Send to Kindle" (routes/deliveries.ts).

async function device(u: TestUser, name = "Kindle") {
  const res = await api(u, "POST", "/api/app-passwords", { name });
  expect(res.statusCode).toBe(201);
  const { id, password } = res.json() as { id: string; password: string };
  const a = await getApp();
  const authorization = `Basic ${Buffer.from(`${u.email}:${password}`).toString("base64")}`;
  const call = (method: string, url: string, payload?: object) =>
    a.inject({
      method: method as "GET",
      url,
      headers: { authorization, ...(payload ? { "content-type": "application/json" } : {}) },
      payload: payload ? JSON.stringify(payload) : undefined,
    });
  return { id, password, call };
}

type Annotation = { id: string; kind: string; [k: string]: unknown };
type SyncAnswer = { cursor: string; changed: Annotation[]; deleted: string[]; skipped: number; book: { id: string } };

/** What one account's live stream (open web readers) receives. */
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

const documentOf = (file: Buffer) => partialMd5(async (o, l) => file.subarray(o, o + l), file.length);

describe("KOReader highlight ranges", () => {
  const spine = packageSpine(OPF, "OEBPS/content.opf");
  const docs = [parseXml(CH1), null, parseXml(CH2), parseXml(CH3)];
  const book: EpubDocuments = { spine, document: (i) => docs[i] ?? null };

  it("joins two CFIs into a range like foliate-js, and splits it back", () => {
    expect(cfiRange("epubcfi(/6/4!/4/2/1:3)", "epubcfi(/6/4!/4/2/1:9)")).toBe("epubcfi(/6/4!/4/2,/1:3,/1:9)");
    expect(cfiRange("epubcfi(/6/4!/4/2/1:3)", "epubcfi(/6/4!/4/6/3:2)")).toBe("epubcfi(/6/4!/4,/2/1:3,/6/3:2)");
    expect(cfiRange("epubcfi(/6/4[c^]h]!/4[x]/2/1:3)", "epubcfi(/6/4[c^]h]!/4[x]/4)")).toBe("epubcfi(/6/4[c^]h]!/4[x],/2/1:3,/4)");
    expect(cfiRange("epubcfi(/6/4!/4/2/1:3)", "epubcfi(/6/6!/4/2/1:9)")).toBeNull(); // two chapters
    expect(cfiRangeEnds("epubcfi(/6/4!/4/2,/1:3,/1:9)")).toEqual({ start: "epubcfi(/6/4!/4/2/1:3)", end: "epubcfi(/6/4!/4/2/1:9)" });
    expect(cfiRangeEnds("epubcfi(/6/4!/4/2/1:3)")).toEqual({ start: "epubcfi(/6/4!/4/2/1:3)", end: "epubcfi(/6/4!/4/2/1:3)" });
    expect(cfiRangeEnds("page:3")).toBeNull();
  });

  it("turns KOReader's pos0/pos1 into a range CFI and back", async () => {
    const pos0 = "/body/DocFragment[1]/body/p[2]/i/text().3";
    const pos1 = "/body/DocFragment[1]/body/p[2]/b/em/text().7";
    const cfi = await xpointerRangeToCfi(book, pos0, pos1);
    expect(cfi).toBe("epubcfi(/6/2!/4/6,/2/1:3,/4/2/1:7)");
    expect(await cfiRangeToXpointers(book, cfi!)).toEqual({ pos0, pos1 });
    // Across chapters, or a position that doesn't convert: none.
    expect(await xpointerRangeToCfi(book, pos0, "/body/DocFragment[2]/body/section/div[1]/p[1]/text()[1].6")).toBeNull();
    expect(await xpointerRangeToCfi(book, pos0, "/body/DocFragment[1]/body/p[9]/text().1")).toBeNull();
  });
});

describe("KOReader plugin", () => {
  it("signs in with an app password only", async () => {
    const u = await signUp();
    const a = await getApp();
    expect((await a.inject({ method: "GET", url: "/api/koreader/me" })).statusCode).toBe(401);
    expect((await api(u, "GET", "/api/koreader/me")).statusCode).toBe(401); // a browser session is not enough
    const wrong = `Basic ${Buffer.from(`${u.email}:password123`).toString("base64")}`;
    expect((await a.inject({ method: "GET", url: "/api/koreader/me", headers: { authorization: wrong } })).statusCode).toBe(401);
    const kindle = await device(u);
    expect((await kindle.call("GET", "/api/koreader/me")).json()).toMatchObject({ email: u.email });
    expect((await kindle.call("POST", "/api/koreader/sync", { document: "0".repeat(32) })).statusCode).toBe(404); // not in the library
  });

  it("syncs EPUB highlights, notes and bookmarks both ways, with deletions", async () => {
    const u = await signUp();
    const file = fixtureEpub();
    const book = (await upload(u, "positions.epub", file)).json();
    const document = await documentOf(file);
    const kindle = await device(u);
    const sync = async (body: object) => {
      const res = await kindle.call("POST", "/api/koreader/sync", { document, ...body });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as SyncAnswer;
    };
    const highlights = async () => (await api(u, "GET", `/api/books/${book.id}/highlights`)).json() as { id: string; cfi: string; note: string | null; color: string; text: string; label: string | null }[];
    const bookmarks = async () => (await api(u, "GET", `/api/books/${book.id}/bookmarks`)).json() as { locator: string; title: string | null; label: string | null }[];

    // KOReader → BookRaven: the passage as a range CFI, with its note, color and chapter.
    const koHighlight = {
      id: "ko-1",
      kind: "highlight",
      text: "occasional intervals, when it was checked by a violent",
      note: "Storm",
      color: "red",
      drawer: "underscore",
      chapter: "Chapter One",
      datetime: "2026-10-20 08:30:00",
      pos0: "/body/DocFragment[1]/body/p[2]/i/text().3",
      pos1: "/body/DocFragment[1]/body/p[2]/b/em/text().7",
      page: "/body/DocFragment[1]/body/p[2]/i/text().3",
    };
    const koBookmark = { id: "ko-2", kind: "bookmark", page: "/body/DocFragment[2]/body/section/div[1]/p[2]/text().7", note: "Come back", chapter: "Two", percent: 0.4, datetime: "2026-10-20 08:31:00" };
    const live = listen(u);
    const first = await sync({ since: null, changed: [koHighlight, koBookmark] });
    // Open web readers update at once.
    expect(live.frames.map((f) => f.event)).toEqual(["highlight.saved", "bookmark.saved"]);
    expect(live.frames[0]!.data).toMatchObject({ bookId: book.id, note: "Storm" });
    expect(first.changed).toEqual([]); // nothing else yet, and what it sent doesn't come back
    expect(first.book.id).toBe(book.id);
    expect(await highlights()).toMatchObject([
      { cfi: "epubcfi(/6/2!/4/6,/2/1:3,/4/2/1:7)", note: "Storm", color: "pink", label: "Chapter One", text: koHighlight.text },
    ]);
    expect(await bookmarks()).toMatchObject([{ locator: "epubcfi(/6/6[ch2ref]!/4[b2]/2/2/4/1:7)", title: "Come back", label: "Two" }]);

    // Nothing changed: nothing comes back.
    const quiet = await sync({ since: first.cursor });
    expect(quiet).toMatchObject({ changed: [], deleted: [], skipped: 0 });

    // BookRaven → KOReader: a web highlight comes with XPointers and an id; a note edit on KOReader's keeps its exact fields.
    const web = (
      await api(u, "POST", `/api/books/${book.id}/highlights`, { cfi: "epubcfi(/6/2!/4/4,/1:9,/1:15)", text: '"dark"', color: "green", label: "Chapter One", note: "Quotes" })
    ).json();
    const [ours] = await highlights();
    await api(u, "PATCH", `/api/highlights/${ours!.id}`, { note: "Storm, again" });
    const bookmarkPut = await api(u, "PUT", `/api/books/${book.id}/bookmarks`, { locator: "epubcfi(/6/8!/4/2/1:13)", percentage: 0.9, title: "End" });
    expect(bookmarkPut.statusCode).toBe(200);
    const second = await sync({ since: first.cursor });
    const byId = new Map(second.changed.map((c) => [c.id, c]));
    expect(byId.get("ko-1")).toMatchObject({ note: "Storm, again", color: "red", drawer: "underscore", pos0: koHighlight.pos0, pos1: koHighlight.pos1, datetime: koHighlight.datetime });
    expect(byId.get(`br-${web.id}`)).toMatchObject({
      kind: "highlight",
      text: '"dark"',
      note: "Quotes",
      color: "green",
      chapter: "Chapter One",
      pos0: "/body/DocFragment[1]/body/p[1]/text().9",
      pos1: "/body/DocFragment[1]/body/p[1]/text().15",
    });
    const brBookmark = second.changed.find((c) => c.kind === "bookmark")!;
    expect(brBookmark).toMatchObject({ page: "/body/DocFragment[3]/body/p/text().10", note: "End" });
    expect(second.changed).toHaveLength(3);

    // KOReader edits BookRaven's highlight's note, and deletes its own bookmark: BookRaven follows.
    const third = await sync({ since: second.cursor, changed: [{ ...byId.get(`br-${web.id}`)!, note: "Quotes!", color: "blue" }], deleted: ["ko-2"] });
    expect(third.changed).toEqual([]);
    expect((await highlights()).find((h) => h.id === web.id)).toMatchObject({ note: "Quotes!", color: "blue" });
    expect((await bookmarks()).map((b) => b.title)).toEqual(["End"]);
    expect(live.frames.slice(-2).map((f) => f.event)).toEqual(["highlight.saved", "bookmark.deleted"]);
    live.stop();

    // BookRaven deletes KOReader's highlight and its own bookmark: KOReader gets the ids to delete.
    expect((await api(u, "DELETE", `/api/highlights/${ours!.id}`)).statusCode).toBe(204);
    expect((await api(u, "DELETE", `/api/books/${book.id}/bookmarks?locator=${encodeURIComponent("epubcfi(/6/8!/4/2/1:13)")}`)).statusCode).toBe(204);
    const fourth = await sync({ since: third.cursor });
    expect(fourth.changed).toEqual([]);
    expect(fourth.deleted.sort()).toEqual(["ko-1", brBookmark.id].sort());

    // An edit KOReader made to a highlight deleted meanwhile: the deletion wins.
    const fifth = await sync({ since: fourth.cursor, changed: [{ ...koHighlight, note: "late" }] });
    expect(fifth.deleted).toEqual(["ko-1"]);
    expect(await highlights()).toHaveLength(1);

    // A second device starting from scratch gets what is left, with the same ids.
    const kobo = await device(u, "Kobo");
    const fresh = (await kobo.call("POST", "/api/koreader/sync", { document, since: null })).json() as SyncAnswer;
    expect(fresh.changed.map((c) => c.id)).toEqual([`br-${web.id}`]);
    expect(fresh.deleted).toEqual([]);
  });

  it("keeps PDF highlights by page and text, and KOReader's exact boxes for its other devices", async () => {
    const u = await signUp();
    const file = fakePdf(50_000);
    const book = (await upload(u, "k.pdf", file)).json();
    const document = await documentOf(file);
    const kindle = await device(u);
    const pos0 = { page: 3, x: 120.5, y: 300, zoom: 1, rotation: 0 };
    const pos1 = { page: 3, x: 410, y: 318, zoom: 1, rotation: 0 };
    const pboxes = [{ x: 118, y: 296, w: 292, h: 24 }];
    const answer = (
      await kindle.call("POST", "/api/koreader/sync", {
        document,
        since: null,
        changed: [
          { id: "ko-p1", kind: "highlight", text: "The raven\nsat  still", color: "yellow", drawer: "lighten", pos0, pos1, pboxes, page: 3, datetime: "2026-10-21 10:00:00" },
          { id: "ko-p2", kind: "bookmark", page: 7, percent: 0.3 },
          // A scanned page has no text: kept for KOReader only.
          { id: "ko-p3", kind: "highlight", text: "", note: "Scanned figure", pos0, pos1, page: 3, datetime: "2026-10-21 10:01:00" },
        ],
      })
    ).json() as SyncAnswer;
    expect(answer.changed).toEqual([]);

    const highlights = (await api(u, "GET", `/api/books/${book.id}/highlights`)).json();
    expect(highlights).toMatchObject([{ cfi: "pdfsearch:3:0:The raven sat still", text: "The raven\nsat  still", color: "yellow" }]);
    expect((await api(u, "GET", `/api/books/${book.id}/bookmarks`)).json()).toMatchObject([{ locator: "page:7", percentage: 0.3 }]);

    // A highlight made in BookRaven: its page and text, for the plugin to find on the page.
    const web = (await api(u, "POST", `/api/books/${book.id}/highlights`, { cfi: "pdf:5:10-24", text: "nevermore", color: "pink" })).json();
    await api(u, "PUT", `/api/books/${book.id}/bookmarks`, { locator: "page:9", percentage: 0.5 });
    const next = (await kindle.call("POST", "/api/koreader/sync", { document, since: answer.cursor })).json() as SyncAnswer;
    expect(next.changed).toEqual([
      expect.objectContaining({ id: `br-${web.id}`, kind: "highlight", page: 5, text: "nevermore", color: "red" }),
      expect.objectContaining({ kind: "bookmark", page: 9 }),
    ]);
    expect(next.changed[0]!.pos0).toBeUndefined();

    // Another KOReader device gets KOReader's highlights exactly as they were made, the text-less one too.
    const kobo = await device(u, "Kobo");
    const fresh = (await kobo.call("POST", "/api/koreader/sync", { document, since: null })).json() as SyncAnswer;
    const p1 = fresh.changed.find((c) => c.id === "ko-p1");
    expect(p1).toMatchObject({ pos0, pos1, pboxes, page: 3, drawer: "lighten", color: "yellow" });
    expect(fresh.changed.find((c) => c.id === "ko-p3")).toMatchObject({ pos0, pos1, kind: "highlight", note: "Scanned figure" });
    expect(fresh.changed.map((c) => c.id).sort()).toEqual(["ko-p1", "ko-p2", "ko-p3", `br-${web.id}`, next.changed[1]!.id].sort());

    // Deleted on one device: the other is told.
    const gone = (await kindle.call("POST", "/api/koreader/sync", { document, since: next.cursor, deleted: ["ko-p3", "ko-p1"] })).json() as SyncAnswer;
    expect(gone.deleted).toEqual([]);
    expect((await api(u, "GET", `/api/books/${book.id}/highlights`)).json()).toHaveLength(1);
    const told = (await kobo.call("POST", "/api/koreader/sync", { document, since: fresh.cursor })).json() as SyncAnswer;
    expect(told.deleted.sort()).toEqual(["ko-p1", "ko-p3"]);
  });
});

describe("Send to Kindle", () => {
  it("queues books for each e-reader, which download them once", async () => {
    const u = await signUp();
    const pdf = fakePdf();
    const book = (await upload(u, "Dune.pdf", pdf, { title: "Dune", author: "Frank Herbert" })).json();
    const kindle = await device(u, "Kindle");
    const kobo = await device(u, "Kobo");
    expect((await kindle.call("GET", "/api/koreader/sent")).json()).toEqual([]);

    const other = await signUp();
    expect((await api(other, "POST", "/api/deliveries", { bookId: book.id })).statusCode).toBe(404); // not their book
    expect((await api(null, "POST", "/api/deliveries", { bookId: book.id })).statusCode).toBe(401);

    const sent = await api(u, "POST", "/api/deliveries", { bookId: book.id });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ bookId: book.id, title: "Dune", deliveredTo: [] });
    const delivery = sent.json() as { id: string };

    const pending = (await kindle.call("GET", "/api/koreader/sent")).json();
    expect(pending).toEqual([
      expect.objectContaining({ id: delivery.id, bookId: book.id, format: "pdf", fileName: "Frank Herbert - Dune.pdf", url: `/opds/books/${book.id}/file`, document: await documentOf(pdf) }),
    ]);
    const download = await kindle.call("GET", pending[0].url);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(pdf)).toBe(true);

    // The OPDS catalog lists it too.
    expect((await kindle.call("GET", "/opds")).body).toContain('href="/opds/sent"');
    const feed = (await kindle.call("GET", "/opds/sent")).body;
    expect(feed).toContain("<title>Dune</title>");
    expect(feed).toContain("<title>Sent to this device</title>");

    expect((await kindle.call("POST", `/api/koreader/sent/${delivery.id}/delivered`)).statusCode).toBe(204);
    expect((await kindle.call("GET", "/api/koreader/sent")).json()).toEqual([]);
    expect((await kobo.call("GET", "/api/koreader/sent")).json()).toHaveLength(1); // the other device still gets it
    const list = (await api(u, "GET", "/api/deliveries")).json();
    expect(list).toMatchObject([{ id: delivery.id, title: "Dune", deliveredTo: [{ name: "Kindle" }] }]);

    // Sending it again sends it to every device again.
    await api(u, "POST", "/api/deliveries", { bookId: book.id });
    expect((await kindle.call("GET", "/api/koreader/sent")).json()).toHaveLength(1);

    expect((await api(other, "DELETE", `/api/deliveries/${delivery.id}`)).statusCode).toBe(404);
    expect((await api(u, "DELETE", `/api/deliveries/${delivery.id}`)).statusCode).toBe(204);
    expect((await api(u, "GET", "/api/deliveries")).json()).toEqual([]);
    expect((await kobo.call("GET", "/api/koreader/sent")).json()).toEqual([]);
    expect((await kindle.call("GET", "/opds/sent")).body).not.toContain("<entry>");
    expect((await kindle.call("POST", `/api/koreader/sent/${delivery.id}/delivered`)).statusCode).toBe(404);
  });
});
