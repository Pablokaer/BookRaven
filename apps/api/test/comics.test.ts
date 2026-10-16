import { randomBytes } from "node:crypto";
import SevenZip from "7z-wasm";
import { describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { cbzKey, objectSize } from "../src/lib/storage.js";
import { api, fakePdf, getApp, ORIGIN, signUp, upload } from "./helpers.js";

/** An archive of `files` made with 7-Zip ("7z" or "tar"). */
async function archive(type: "7z" | "tar", files: Record<string, Buffer>) {
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  sz.FS.mkdir("/src");
  sz.FS.mkdir("/src/pages");
  for (const [name, data] of Object.entries(files)) sz.FS.writeFile(`/src/${name}`, data);
  sz.FS.chdir("/src");
  sz.callMain(["a", `-t${type}`, `/out.${type}`, "*"]);
  return Buffer.from(sz.FS.readFile(`/out.${type}`));
}

const pages = { "pages/p1.jpg": randomBytes(70_000), "pages/p2.jpg": randomBytes(90_000), "ComicInfo.xml": Buffer.from("<ComicInfo/>") };

describe("comic archives read by ranges", () => {
  it("serves a 7z or TAR comic as a CBZ copy, in ranges, and removes the copy with the book", async () => {
    const user = await signUp();
    for (const [type, name] of [["7z", "comic.cb7"], ["tar", "comic.cbt"]] as const) {
      const res = await upload(user, name, await archive(type, pages));
      expect(res.statusCode).toBe(201);
      const book = res.json();

      const cbz = await api(user, "GET", `/api/books/${book.id}/file?as=cbz`);
      expect(cbz.statusCode).toBe(200);
      expect(cbz.headers["content-type"]).toBe("application/vnd.comicbook+zip");
      expect(cbz.headers["content-disposition"]).toContain("comic.cbz");
      expect(cbz.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
      // Pages are stored as they are (no recompression), so the copy is about the archive's size.
      expect(cbz.rawPayload.length).toBeGreaterThan(160_000);
      expect(cbz.rawPayload.includes("pages/p2.jpg")).toBe(true);

      const a = await getApp();
      const part = await a.inject({
        method: "GET",
        url: `/api/books/${book.id}/file?as=cbz`,
        headers: { origin: ORIGIN, cookie: user.cookie, range: "bytes=0-9" },
      });
      expect(part.statusCode).toBe(206);
      expect(part.headers["content-range"]).toBe(`bytes 0-9/${cbz.rawPayload.length}`);
      expect(part.rawPayload.equals(cbz.rawPayload.subarray(0, 10))).toBe(true);

      const { rows } = await query<{ sha256: string }>("SELECT sha256 FROM book WHERE id = $1", [book.id]);
      expect(await objectSize(cbzKey(rows[0]!.sha256))).toBe(cbz.rawPayload.length);
      expect((await api(user, "DELETE", `/api/books/${book.id}`)).statusCode).toBe(204);
      expect(await objectSize(cbzKey(rows[0]!.sha256))).toBeNull();
    }
  });

  it("refuses formats that aren't comic archives and archives 7-Zip can't read", async () => {
    const user = await signUp();
    const pdf = (await upload(user, "a.pdf", fakePdf())).json();
    expect((await api(user, "GET", `/api/books/${pdf.id}/file?as=cbz`)).statusCode).toBe(400);
    expect((await api(user, "GET", `/api/books/${pdf.id}/file`)).statusCode).toBe(200);

    const broken = Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), randomBytes(4000)]);
    const comic = (await upload(user, "broken.cb7", broken)).json();
    expect((await api(user, "GET", `/api/books/${comic.id}/file?as=cbz`)).statusCode).toBe(422);
    // The original is still there to download.
    expect((await api(user, "GET", `/api/books/${comic.id}/file`)).rawPayload.equals(broken)).toBe(true);

    const stranger = await signUp();
    expect((await api(stranger, "GET", `/api/books/${comic.id}/file`)).statusCode).toBe(404);
    expect((await api(stranger, "GET", `/api/books/not-a-uuid/file`)).statusCode).toBe(404);
  });

  it("lets browsers keep the CORS preflight of range requests", async () => {
    const a = await getApp();
    const res = await a.inject({
      method: "OPTIONS",
      url: "/api/books/00000000-0000-0000-0000-000000000000/file",
      headers: { origin: ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "range,authorization" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-max-age"]).toBe("7200");
  });
});
